import { Effect, Either } from "effect"
import * as Exit from "effect/Exit"
import { access, chmod, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path"
import { defaultCliConfig, type CliConfig } from "./config.js"
import { headlessFailureMessage, parseHeadlessResult, supportsHeadlessOperationResults, type MooseNexusHeadlessResult } from "./headless-result.js"
import { CommandFailure, runCommand } from "./process.js"
import { resolveMooseNexusRelease } from "./releases.js"
import { mooseNexusHomeDirectory, runtimeDirectory } from "./runtime.js"
import { externalBuildScript, externalModelBuildScript, inlineBuildScript, inlineModelBuildScript, installImageProjectScript, installModelBundleScript, loadMooseNexusScript, metacelloRepository, publishModelScript, rebaseImageModelScript } from "./scripts.js"
import { withWorkspace, type Workspace } from "./workspace.js"

export interface WorkflowStep {
  readonly name: string
  readonly detail: string
}

export interface WorkflowProgress {
  start(step: WorkflowStep): void
  complete(step: WorkflowStep): void
  fail(step: WorkflowStep): void
  skip(step: WorkflowStep): void
}

export interface BuildImagePlan {
  readonly config: CliConfig
  readonly steps: ReadonlyArray<WorkflowStep>
}

export interface BuildModelPlan {
  readonly config: CliConfig
  readonly steps: ReadonlyArray<WorkflowStep>
}

export interface BuildImageResult {
  readonly artifactPath?: string
  readonly adoptedImagePath?: string
  readonly directory?: string
  readonly imagePath?: string
  readonly mooseNexusVersion: string
  readonly workspaceDirectory?: string
  readonly ociReference?: string
}

export interface PullImageResult {
  readonly adoptedImagePath?: string
  readonly directory: string
  readonly imagePath: string
}

export interface ImageAdoption {
  readonly destinationDirectory?: string
  readonly name?: string
}

export interface AdoptedImageResult {
  readonly directory: string
  readonly imagePath: string
}

interface ProjectCoordinates {
  readonly group: string
  readonly name: string
  readonly version: string
}

interface HeadlessOperationExpectation {
  readonly operation: string
  readonly phase: string
  readonly resultPath: string
}

export interface BuildModelResult {
  readonly mooseNexusVersion: string
  readonly ociReference?: string
  readonly exportedProjectDirectory?: string
  readonly projectDirectory?: string
  readonly workspaceDirectory?: string
}

export interface PullModelResult {
  readonly reference: string
  readonly repositoryDirectory: string
}

interface RuntimeCacheState {
  readonly hasPharoVm: boolean
  readonly hasMooseImage: boolean
}

export const planBuildImage = (
  config: CliConfig,
  options: { readonly install?: boolean } = {}
): Effect.Effect<BuildImagePlan, Error> =>
  runtimeCacheState(config).pipe(
    Effect.map((cache) => ({
      config,
      steps: imageSteps(config, cache, options.install ?? true)
    }))
  )

const imageSteps = (
  config: CliConfig,
  cache: RuntimeCacheState,
  install: boolean
): ReadonlyArray<WorkflowStep> =>
  [
      { name: "workspace", detail: "Create an isolated temporary workspace" },
      {
        name: "pharo-vm",
        detail: cache.hasPharoVm
          ? `Reuse cached Pharo ${config.pharo.version} VM`
          : `Install Pharo ${config.pharo.version} VM from ${pharoVmUrl(config)}`
      },
      {
        name: "moose-image",
        detail: cache.hasMooseImage
          ? `Copy cached Moose ${config.moose.version} runtime into the workspace`
          : `Download and extract Moose ${config.moose.version} from ${mooseImageUrl(config)}`
      },
      {
        name: "load-moosenexus",
        detail: cache.hasMooseImage
          ? `Reuse MooseNexus ${config.moosenexus.version} from the cached runtime`
          : `Load MooseNexus ${config.moosenexus.version} from ${metacelloRepository(config)} and cache the runtime`
      },
      ...(isTypeScriptBuild(config) ? [{
        name: "typescript-runner",
        detail: `Provision ts2famix ${config.buildSpec.ts2famix!.revision} in the isolated workspace`
      }] : []),
      {
        name: "execute-spec",
        detail: config.buildSpec.file === undefined
          ? "Materialize a MooseNexus build spec from CLI inputs and execute it"
          : `Execute ${config.buildSpec.file}`
      },
      {
        name: "package-artifact",
        detail: config.artifact.outputDirectory === undefined && config.oci === undefined
          ? "Skip portable image packaging"
          : `Package the saved image as ${artifactFileName(config)}`
      },
      {
        name: "publish",
        detail: config.oci === undefined ? "Skip OCI publication" : `Publish ${ociReference(config)} through ORAS`
      },
      { name: "install", detail: install ? "Install project metadata into the local MooseNexus repository" : "Skip local repository installation" },
      { name: "rebase", detail: install ? "Rebase model sources in the built image" : "Skip image source rebasing" },
      { name: "store", detail: install ? "Store the rebased image in the local MooseNexus repository" : "Skip image storage" }
  ]

export const planBuildModel = (
  config: CliConfig,
  options: { readonly install?: boolean } = {}
): Effect.Effect<BuildModelPlan, Error> =>
  runtimeCacheState(config).pipe(
    Effect.map((cache) => ({
      config,
      steps: modelSteps(config, cache, options.install ?? true)
    }))
  )

const modelSteps = (
  config: CliConfig,
  cache: RuntimeCacheState,
  install: boolean
): ReadonlyArray<WorkflowStep> =>
  [
      { name: "workspace", detail: "Create an isolated temporary workspace" },
      {
        name: "pharo-vm",
        detail: cache.hasPharoVm
          ? `Reuse cached Pharo ${config.pharo.version} VM`
          : `Install Pharo ${config.pharo.version} VM from ${pharoVmUrl(config)}`
      },
      {
        name: "moose-image",
        detail: cache.hasMooseImage
          ? `Copy cached Moose ${config.moose.version} runtime into the workspace`
          : `Download and extract Moose ${config.moose.version} from ${mooseImageUrl(config)}`
      },
      {
        name: "load-moosenexus",
        detail: cache.hasMooseImage
          ? `Reuse MooseNexus ${config.moosenexus.version} from the cached runtime`
          : `Load MooseNexus ${config.moosenexus.version} from ${metacelloRepository(config)} and cache the runtime`
      },
      ...(isTypeScriptBuild(config) ? [{
        name: "typescript-runner",
        detail: `Provision ts2famix ${config.buildSpec.ts2famix!.revision} in the isolated workspace`
      }] : []),
      {
        name: "execute-spec",
        detail: config.buildSpec.file === undefined
          ? "Materialize a MooseNexus build spec from CLI inputs and execute it"
          : `Execute ${config.buildSpec.file}`
      },
      {
        name: "export",
        detail: config.artifact.outputDirectory === undefined
          ? "Skip portable project export"
          : `Export the project to ${resolve(config.artifact.outputDirectory)}`
      },
      { name: "install", detail: install ? "Install the model into the local MooseNexus repository" : "Skip local repository installation" },
      { name: "publish", detail: config.oci === undefined ? "Skip OCI publication" : `${modelPublicationDescription(config)} through MooseNexus and ORAS` }
  ]

export const executeBuildImage = (
  config: CliConfig,
  options: {
    readonly adoption?: ImageAdoption
    readonly force?: boolean
    readonly install: boolean
    readonly keepWorkspace: boolean
    readonly progress?: WorkflowProgress
  }
): Effect.Effect<BuildImageResult, Error> =>
  runtimeCacheState(config).pipe(
    Effect.flatMap((cache) => {
      const steps = imageSteps(config, cache, options.install)
      return withFreshMoose(config, options.keepWorkspace, steps, cache, options.progress, (workspace, imagePath, progress, steps, vmPath, typeScriptRunnerCommand) =>
        Effect.gen(function* () {
          const buildOperation = headlessOperationExpectation(workspace, config, "build-image", "execute-spec")
          yield* runStep(progress, stepNamed(steps, "execute-spec"), writeBuildScript(config, workspace, typeScriptRunnerCommand, buildOperation?.resultPath).pipe(
            Effect.zipRight(runSmalltalk(
              vmPath,
              workspace,
              imagePath,
              join(workspace.scriptsDirectory, "build.st"),
              "executing the generated MooseNexus build script",
              buildOperation
            ))
          ))
          const needsPortableArtifact = config.artifact.outputDirectory !== undefined || config.oci !== undefined
          const project = yield* recordedProject(imagePath, config.buildSpec.coordinates)
          const stagedArtifactPath = needsPortableArtifact
            ? yield* runStep(progress, stepNamed(steps, "package-artifact"), packageArtifact(config, workspace, imagePath, project.provenance))
            : (progress.skip(stepNamed(steps, "package-artifact")), undefined)
          const artifactPath = stagedArtifactPath === undefined
            ? undefined
            : yield* retainArtifact(config, stagedArtifactPath)
          const reference = stagedArtifactPath === undefined
            ? (progress.skip(stepNamed(steps, "publish")), undefined)
            : config.oci === undefined
              ? (progress.skip(stepNamed(steps, "publish")), undefined)
              : yield* runStep(progress, stepNamed(steps, "publish"), publishArtifact(config, stagedArtifactPath))

          if (!options.install) {
            progress.skip(stepNamed(steps, "install"))
            progress.skip(stepNamed(steps, "rebase"))
            progress.skip(stepNamed(steps, "store"))
            return {
              mooseNexusVersion: project.provenance.mooseNexusVersion,
              ...(artifactPath === undefined ? {} : { artifactPath }),
              ...(options.keepWorkspace ? { workspaceDirectory: workspace.directory } : {}),
              ...(reference === undefined ? {} : { ociReference: reference })
            }
          }

          const repositoryDirectory = mooseNexusHomeDirectory()
          const repositoryRuntimeConfig = yield* currentRepositoryRuntimeConfig(config)
          const installedProjectDirectory = projectDirectoryInRepository(repositoryDirectory, project.coordinates)

          yield* installPulledProject(
            repositoryRuntimeConfig,
            project.directory,
            options.force ?? false,
            repositoryDirectory,
            progress
          )
          yield* rebasePulledImage(config, imagePath, project.coordinates, project.modelName, repositoryDirectory, progress)
          yield* runStep(
            progress,
            stepNamed(steps, "store"),
            materializeImageArtifact(installedProjectDirectory, imagePath, project.modelName, true)
          )
          const imageDirectory = join(installedProjectDirectory, "artifacts", "images", project.modelName)
          const installedImagePath = join(imageDirectory, basename(imagePath))
          const adopted = options.adoption === undefined
            ? undefined
            : yield* executeImageAdoption(project.coordinates, options.adoption, progress)

          return {
            mooseNexusVersion: project.provenance.mooseNexusVersion,
            ...(artifactPath === undefined ? {} : { artifactPath }),
            ...(adopted === undefined ? {} : { adoptedImagePath: adopted.imagePath }),
            directory: imageDirectory,
            imagePath: installedImagePath,
            ...(options.keepWorkspace ? { workspaceDirectory: workspace.directory } : {}),
            ...(reference === undefined ? {} : { ociReference: reference })
          }
        })
      )
    })
  )

export const executeBuildModel = (
  config: CliConfig,
  options: { readonly force?: boolean; readonly install: boolean; readonly keepWorkspace: boolean; readonly progress?: WorkflowProgress }
): Effect.Effect<BuildModelResult, Error> =>
  runtimeCacheState(config).pipe(
    Effect.flatMap((cache) => {
      const steps = modelSteps(config, cache, options.install)
      return withFreshMoose(config, options.keepWorkspace, steps, cache, options.progress, (workspace, imagePath, progress, steps, vmPath, typeScriptRunnerCommand) =>
        Effect.gen(function* () {
          const buildOperation = headlessOperationExpectation(workspace, config, "build-model", "execute-spec")
          yield* runStep(progress, stepNamed(steps, "execute-spec"), writeModelBuildScript(config, workspace, typeScriptRunnerCommand, buildOperation?.resultPath).pipe(
            Effect.zipRight(runSmalltalk(
              vmPath,
              workspace,
              imagePath,
              join(workspace.scriptsDirectory, "build-model.st"),
              "executing the generated MooseNexus model build script",
              buildOperation
            ))
          ))
          const project = yield* recordedProject(imagePath, config.buildSpec.coordinates)
          const repositoryDirectory = mooseNexusHomeDirectory()
          const exportedProjectDirectory = config.artifact.outputDirectory === undefined
            ? (progress.skip(stepNamed(steps, "export")), undefined)
            : yield* runStep(progress, stepNamed(steps, "export"), retainProject(config, project, options.force ?? false))
          const installed = options.install
          if (installed) {
            yield* installPulledProject(
              yield* currentRepositoryRuntimeConfig(config),
              project.directory,
              options.force ?? false,
              repositoryDirectory,
              progress
            )
          } else {
            progress.skip(stepNamed(steps, "install"))
          }

          if (config.oci === undefined) {
            progress.skip(stepNamed(steps, "publish"))
          } else {
            const publishOperation = headlessOperationExpectation(workspace, config, "publish-model", "publish")
            yield* runStep(progress, stepNamed(steps, "publish"), writeModelPublishScript(config, workspace, installed ? repositoryDirectory : undefined, publishOperation?.resultPath).pipe(
              Effect.zipRight(runSmalltalk(
                vmPath,
                workspace,
                imagePath,
                join(workspace.scriptsDirectory, "publish-model.st"),
                "publishing the recorded MooseNexus model artifact",
                publishOperation
              ))
            ))
          }
          return {
            mooseNexusVersion: project.provenance.mooseNexusVersion,
            ...(config.oci === undefined || config.buildSpec.coordinates === undefined ? {} : { ociReference: modelOciReference(config) }),
            ...(exportedProjectDirectory === undefined ? {} : { exportedProjectDirectory }),
            ...(installed ? { projectDirectory: projectDirectoryInRepository(repositoryDirectory, project.coordinates) } : {}),
            ...(options.keepWorkspace ? { workspaceDirectory: workspace.directory } : {})
          }
        })
      )
    })
  )

export const pullModel = (
  reference: string,
  force: boolean,
  progress: WorkflowProgress = silentProgress
): Effect.Effect<PullModelResult, Error> =>
  withWorkspace(false, (workspace) =>
    Effect.gen(function* () {
      const manifestPath = join(workspace.downloadsDirectory, "moosenexus-artifact-manifest.json")
      yield* runStep(progress, { name: "download", detail: `Download ${reference} through ORAS` }, runCommand("oras", [
        "pull",
        "--output", workspace.downloadsDirectory,
        "--config", manifestPath,
        reference
      ], { cwd: workspace.directory }))
      const config = yield* modelRuntimeConfig(manifestPath)

      return yield* withTrustedMooseRuntime(config, (runtimeWorkspace, imagePath, vmPath) =>
        Effect.gen(function* () {
          const scriptPath = join(runtimeWorkspace.scriptsDirectory, "install-model-bundle.st")
          const installOperation = headlessOperationExpectation(runtimeWorkspace, config, "install-model", "install")
          yield* Effect.tryPromise({
            try: () => writeFile(scriptPath, installModelBundleScript(workspace.downloadsDirectory, force, installOperation?.resultPath, mooseNexusHomeDirectory())),
            catch: (error) => error instanceof Error ? error : new Error(String(error))
          })
          yield* runStep(progress, { name: "install", detail: "Install the model into the default MooseNexus repository" }, runSmalltalk(
            vmPath,
            runtimeWorkspace,
            imagePath,
            scriptPath,
            "installing the pulled model into the default MooseNexus repository",
            installOperation
          ))
          return { reference, repositoryDirectory: mooseNexusHomeDirectory() }
        })
      )
    })
  )

export const pullImage = (
  reference: string,
  coordinates: ProjectCoordinates,
  outputDirectory: string | undefined,
  force: boolean,
  adoption: ImageAdoption | undefined,
  progress: WorkflowProgress = silentProgress
): Effect.Effect<PullImageResult, Error> =>
  withWorkspace(false, (workspace) =>
    Effect.gen(function* () {
      if (outputDirectory !== undefined && adoption !== undefined) {
        return yield* Effect.fail(new Error("--out cannot be combined with image adoption. Pull into the default repository before adopting the image."))
      }

      yield* runStep(progress, { name: "download", detail: `Download ${reference} through ORAS` }, runCommand("oras", ["pull", "--output", workspace.downloadsDirectory, reference], { cwd: workspace.directory }))
      const archives = yield* findFilesEffect(workspace.downloadsDirectory, ".zip")
      if (archives.length !== 1) {
        return yield* Effect.fail(new Error(`Expected one image artifact ZIP from ${reference}, found ${archives.length}.`))
      }
      const unpackedDirectory = join(workspace.directory, "unpacked")
      yield* runStep(progress, { name: "unpack", detail: "Unpack the image artifact" }, runCommand("unzip", ["-q", archives[0]!, "-d", unpackedDirectory], { cwd: workspace.directory }))
      const imagePath = yield* validatePulledImage(unpackedDirectory)
      const artifactRuntimeConfig = yield* imageRuntimeConfig(unpackedDirectory)
      const repositoryRuntimeConfig = yield* currentRepositoryRuntimeConfig(artifactRuntimeConfig)
      const projectDirectory = repositoryProjectDirectory(unpackedDirectory, coordinates)
      const modelName = yield* Effect.tryPromise({
        try: () => modelArtifactName(projectDirectory),
        catch: (error) => error instanceof Error ? error : new Error(String(error))
      })

      const destination = outputDirectory === undefined ? undefined : pulledImageDirectory(outputDirectory, coordinates)
      if (destination !== undefined) {
        yield* Effect.tryPromise({
          try: () => mkdir(destination, { recursive: true }),
          catch: (error) => error instanceof Error ? error : new Error(String(error))
        })
      }

      const repositoryDirectory = destination === undefined
        ? mooseNexusHomeDirectory()
        : join(destination, "pharo-local", "MooseNexus")
      const installedProjectDirectory = projectDirectoryInRepository(repositoryDirectory, coordinates)

      yield* installPulledProject(
        repositoryRuntimeConfig,
        projectDirectory,
        force,
        repositoryDirectory,
        progress
      )
      yield* rebasePulledImage(
        artifactRuntimeConfig,
        imagePath,
        coordinates,
        modelName,
        repositoryDirectory,
        progress
      )

      yield* runStep(
        progress,
        { name: "store", detail: `Store the rebased image in the ${destination === undefined ? "default" : "image-scoped"} repository` },
        materializeImageArtifact(installedProjectDirectory, imagePath, modelName, destination === undefined)
      )

      if (destination !== undefined) {
        yield* copyImageArtifactRoot(imagePath, unpackedDirectory, destination, force)
      }

      const imageDirectory = join(installedProjectDirectory, "artifacts", "images", modelName)
      const installedImagePath = join(imageDirectory, basename(imagePath))
      const adopted = adoption === undefined
        ? undefined
        : yield* executeImageAdoption(coordinates, adoption, progress).pipe(
            Effect.mapError((error) => adoptionFailure(error, coordinates, adoption))
          )

      return {
        directory: imageDirectory,
        imagePath: installedImagePath,
        ...(adopted === undefined ? {} : { adoptedImagePath: adopted.imagePath })
      }
    })
  )

export const adoptImage = (
  coordinates: ProjectCoordinates,
  adoption: ImageAdoption = {}
): Effect.Effect<AdoptedImageResult, Error> =>
  Effect.tryPromise({
    try: async () => {
      const projectDirectory = projectDirectoryInRepository(mooseNexusHomeDirectory(), coordinates)
      const modelArtifact = await imageModelArtifactName(projectDirectory)
      const sourceDirectory = join(projectDirectory, "artifacts", "images", modelArtifact)
      const sourceImagePath = await findInstalledImage(sourceDirectory)
      const name = adoption.name ?? basename(sourceImagePath, extname(sourceImagePath))
      const destinationRoot = resolveAdoptionDirectory(adoption.destinationDirectory)

      return copyAdoptedImage(sourceImagePath, name, destinationRoot)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

export const executeImageAdoption = (
  coordinates: ProjectCoordinates,
  adoption: ImageAdoption,
  progress: WorkflowProgress = silentProgress
): Effect.Effect<AdoptedImageResult, Error> =>
  runStep(progress, { name: "adopt", detail: adoptionDescription(adoption) }, adoptImage(coordinates, adoption))

const adoptionDescription = (adoption: ImageAdoption): string =>
  `Adopt the image into ${resolveAdoptionDirectory(adoption.destinationDirectory)}`

const adoptionFailure = (error: Error, coordinates: ProjectCoordinates, adoption: ImageAdoption): Error =>
  new Error([
    error.message,
    "The image artifact remains installed in the MooseNexus repository.",
    "Adopt it later with:",
    adoptImageCommand(coordinates, adoption)
  ].join("\n"))

const adoptImageCommand = (coordinates: ProjectCoordinates, adoption: ImageAdoption): string =>
  [
    "moosenexus adopt-image",
    `--project-group ${shellQuote(coordinates.group)}`,
    `--project-name ${shellQuote(coordinates.name)}`,
    `--project-version ${shellQuote(coordinates.version)}`,
    ...(adoption.name === undefined ? [] : [`--adopt-as ${shellQuote(adoption.name)}`]),
    ...(adoption.destinationDirectory === undefined ? [] : [`--adopt-to ${shellQuote(adoption.destinationDirectory)}`])
  ].join(" ")

const shellQuote = (value: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\\"'\\\"'")}'`

export const renderPlan = (plan: BuildImagePlan): string =>
  [
    "MooseNexus build-image plan",
    "",
    `MooseNexus: ${mooseNexusSummary(plan.config)}`,
    `Moose:      ${plan.config.moose.version}`,
    `Pharo:      ${plan.config.pharo.version}`,
    `Spec:       ${specSummary(plan.config)}`,
    `Extractor:  ${extractorDescription(plan.config)}`,
    `Output:     ${plan.config.artifact.outputDirectory === undefined ? "default MooseNexus repository" : artifactOutputPath(plan.config)}`,
    "",
    ...plan.steps.map((step, index) => `${index + 1}. ${step.name}: ${step.detail}`)
  ].join("\n")

export const renderModelPlan = (plan: BuildModelPlan): string =>
  [
    "MooseNexus build-model plan",
    "",
    `MooseNexus: ${mooseNexusSummary(plan.config)}`,
    `Moose:      ${plan.config.moose.version}`,
    `Pharo:      ${plan.config.pharo.version}`,
    `Spec:       ${specSummary(plan.config)}`,
    `Extractor:  ${extractorDescription(plan.config)}`,
    `Publish:    ${modelPublicationDescription(plan.config)}`,
    "",
    ...plan.steps.map((step, index) => `${index + 1}. ${step.name}: ${step.detail}`)
  ].join("\n")

export const renderBuildStart = (plan: BuildImagePlan): string =>
  [
    "MooseNexus build-image",
    "",
    `MooseNexus: ${mooseNexusSummary(plan.config)}`,
    `Moose:      ${plan.config.moose.version}`,
    `Pharo:      ${plan.config.pharo.version}`,
    `Spec:       ${specSummary(plan.config)}`,
    `Extractor:  ${extractorDescription(plan.config)}`,
    `Output:     ${plan.config.artifact.outputDirectory === undefined ? "default MooseNexus repository" : artifactOutputPath(plan.config)}`,
    ""
  ].join("\n")

export const renderModelBuildStart = (plan: BuildModelPlan): string =>
  [
    "MooseNexus build-model",
    "",
    `MooseNexus: ${mooseNexusSummary(plan.config)}`,
    `Moose:      ${plan.config.moose.version}`,
    `Pharo:      ${plan.config.pharo.version}`,
    `Spec:       ${specSummary(plan.config)}`,
    `Extractor:  ${extractorDescription(plan.config)}`,
    `Publish:    ${modelPublicationDescription(plan.config)}`,
    ""
  ].join("\n")

export const renderBuildResult = (result: BuildImageResult): string =>
  [
    "MooseNexus image artifact built successfully.",
    `MooseNexus: ${result.mooseNexusVersion}`,
    ...(result.artifactPath === undefined ? [] : [`Artifact: ${result.artifactPath}`]),
    ...(result.directory === undefined ? [] : [`Directory: ${result.directory}`]),
    ...(result.imagePath === undefined ? [] : [`Image: ${result.imagePath}`]),
    ...(result.adoptedImagePath === undefined ? [] : [`Adopted image: ${result.adoptedImagePath}`]),
    ...(result.ociReference === undefined ? [] : [`Published: ${result.ociReference}`]),
    ...(result.workspaceDirectory === undefined ? [] : [`Workspace: ${result.workspaceDirectory}`])
  ].join("\n")

export const renderBuildModelResult = (result: BuildModelResult): string =>
  [
    "MooseNexus model artifact built successfully.",
    `MooseNexus: ${result.mooseNexusVersion}`,
    ...(result.projectDirectory === undefined ? [] : [`Directory: ${result.projectDirectory}`]),
    ...(result.exportedProjectDirectory === undefined ? [] : [`Export: ${result.exportedProjectDirectory}`]),
    ...(result.ociReference === undefined ? [] : [`Published: ${result.ociReference}`]),
    ...(result.workspaceDirectory === undefined ? [] : [`Workspace: ${result.workspaceDirectory}`])
  ].join("\n")

export const renderPullStart = (
  reference: string,
  outputDirectory: string | undefined,
  adoption: ImageAdoption | undefined = undefined
): string =>
  [
    "MooseNexus pull-image",
    "",
    `Reference:   ${reference}`,
    `Destination: ${outputDirectory ?? "default MooseNexus repository"}`,
    ...(adoption === undefined ? [] : [`Adoption:    ${adoptionDescription(adoption)}`]),
    ""
  ].join("\n")

export const renderPullModelStart = (reference: string): string =>
  [
    "MooseNexus pull-model",
    "",
    `Reference:   ${reference}`,
    "Destination: default MooseNexus repository",
    ""
  ].join("\n")

export const renderPullResult = (result: PullImageResult): string =>
  [
    "MooseNexus image artifact pulled successfully.",
    `Directory: ${result.directory}`,
    `Image: ${result.imagePath}`,
    ...(result.adoptedImagePath === undefined ? [] : [`Adopted image: ${result.adoptedImagePath}`])
  ].join("\n")

export const renderAdoptImageStart = (coordinates: ProjectCoordinates, adoption: ImageAdoption): string =>
  [
    "MooseNexus adopt-image",
    "",
    `Project: ${coordinates.group}:${coordinates.name}:${coordinates.version}`,
    `Destination: ${resolveAdoptionDirectory(adoption.destinationDirectory)}`,
    ""
  ].join("\n")

export const renderAdoptImageResult = (result: AdoptedImageResult): string =>
  [
    "MooseNexus image artifact adopted successfully.",
    `Directory: ${result.directory}`,
    `Image: ${result.imagePath}`
  ].join("\n")

export const renderPullModelResult = (result: PullModelResult): string =>
  [
    "MooseNexus model artifact pulled successfully.",
    `Reference: ${result.reference}`,
    `Installed in: ${result.repositoryDirectory}`
  ].join("\n")

export const pharoVmUrl = (config: CliConfig): string =>
  config.pharo.vmUrl ?? `https://get.pharo.org/64/vm${majorVersion(config.pharo.version)}0`

export const mooseImageUrl = (config: CliConfig): string =>
  config.moose.imageUrl
  ?? `https://github.com/moosetechnology/Moose/releases/download/v${config.moose.version}/Moose${majorVersion(config.moose.version)}-stable-Pharo64-${majorVersion(config.pharo.version)}.zip`

export const artifactFileName = (config: CliConfig): string => {
  const coordinates = config.buildSpec.coordinates
  if (coordinates === undefined) {
    return `moosenexus-image.${config.artifact.format}`
  }
  return `${[coordinates.group, coordinates.name, coordinates.version].map(normalize).join("-")}-image.${config.artifact.format}`
}

export const artifactOutputPath = (config: CliConfig): string =>
  resolve(config.artifact.outputDirectory ?? mooseNexusHomeDirectory(), artifactFileName(config))

export const pulledImageDirectory = (outputDirectory: string, coordinates: ProjectCoordinates): string =>
  resolve(outputDirectory, [coordinates.group, coordinates.name, coordinates.version].map(normalize).join("-"))

export const ociReference = (config: CliConfig): string => {
  if (config.oci === undefined || config.buildSpec.coordinates === undefined) {
    throw new Error("OCI publication requires project coordinates.")
  }

  return imageOciReference(config.oci.registry, config.oci.namespace, config.buildSpec.coordinates)
}

export const modelOciReference = (config: CliConfig): string => {
  if (config.oci === undefined || config.buildSpec.coordinates === undefined) {
    throw new Error("Model publication requires project coordinates and an OCI target.")
  }

  return modelOciReferenceForCoordinates(config.oci.registry, config.oci.namespace, config.buildSpec.coordinates)
}

const modelPublicationDescription = (config: CliConfig): string =>
  config.oci === undefined
    ? "Skip OCI publication"
    : config.buildSpec.coordinates === undefined
    ? "Publish the model produced by the build spec"
    : `Publish ${modelOciReference(config)}`

const mooseNexusSummary = (config: CliConfig): string => {
  const revision = config.moosenexus.resolvedRevision
  return revision === undefined
    ? config.moosenexus.version
    : `${config.moosenexus.version} (${revision.slice(0, 12)})`
}

interface OciProjectCoordinates {
  readonly group: string
  readonly name: string
  readonly version: string
}

export const imageOciReference = (registry: string, namespace: string, coordinates: OciProjectCoordinates): string =>
  ociReferenceForCoordinates(registry, namespace, coordinates, "-image")

export const modelOciReferenceForCoordinates = (registry: string, namespace: string, coordinates: OciProjectCoordinates): string =>
  ociReferenceForCoordinates(registry, namespace, coordinates, "")

const ociReferenceForCoordinates = (
  registry: string,
  namespace: string,
  coordinates: OciProjectCoordinates,
  tagSuffix: string
): string => {
  const normalizedNamespace = namespace.split("/").filter(Boolean).map(normalize).join("/")
  return [
    registry,
    normalizedNamespace,
    "moosenexus",
    normalize(coordinates.group),
    `${normalize(coordinates.name)}:${normalize(coordinates.version)}${tagSuffix}`
  ].join("/")
}

const downloadMooseImage = (config: CliConfig, workspace: Workspace): Effect.Effect<void, Error> =>
  download(mooseImageUrl(config), join(workspace.downloadsDirectory, "moose.zip")).pipe(
    Effect.zipRight(runCommand("unzip", ["-q", join(workspace.downloadsDirectory, "moose.zip"), "-d", workspace.imageDirectory], { cwd: workspace.directory })),
    Effect.asVoid
  )

const installPharoVm = (config: CliConfig, workspace: Workspace): Effect.Effect<void, Error> => {
  const installer = join(workspace.downloadsDirectory, "install-pharo-vm.sh")
  return download(pharoVmUrl(config), installer).pipe(
    Effect.zipRight(runCommand("bash", [installer], { cwd: workspace.vmDirectory })),
    Effect.asVoid
  )
}

const download = (url: string, target: string): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
      }
      await writeFile(target, new Uint8Array(await response.arrayBuffer()))
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const withFreshMoose = <A>(
  config: CliConfig,
  keepWorkspace: boolean,
  steps: ReadonlyArray<WorkflowStep>,
  cache: RuntimeCacheState,
  reporter: WorkflowProgress | undefined,
  use: (
    workspace: Workspace,
    imagePath: string,
    progress: WorkflowProgress,
    steps: ReadonlyArray<WorkflowStep>,
    vmPath: string,
    typeScriptRunnerCommand: string | undefined
  ) => Effect.Effect<A, Error>
): Effect.Effect<A, Error> => {
  const progress = reporter ?? silentProgress
  const workspaceStep = stepNamed(steps, "workspace")
  return Effect.sync(() => progress.start(workspaceStep)).pipe(
    Effect.zipRight(withWorkspace(keepWorkspace, (workspace) =>
      Effect.sync(() => progress.complete(workspaceStep)).pipe(
        Effect.zipRight(Effect.gen(function* () {
          const vmPath = yield* runStep(progress, stepNamed(steps, "pharo-vm"), provisionPharoVm(config, workspace))
          const imagePath = cache.hasMooseImage
            ? yield* runStep(progress, stepNamed(steps, "moose-image"), copyTrustedMooseRuntime(config, workspace))
            : yield* runStep(progress, stepNamed(steps, "moose-image"), downloadMooseImage(config, workspace).pipe(
              Effect.zipRight(findImage(workspace.imageDirectory))
            ))

          if (cache.hasMooseImage) {
            progress.skip(stepNamed(steps, "load-moosenexus"))
          } else {
            yield* runStep(progress, stepNamed(steps, "load-moosenexus"), writeLoadScript(config, workspace).pipe(
              Effect.zipRight(runSmalltalk(
                vmPath,
                workspace,
                imagePath,
                join(workspace.scriptsDirectory, "load-moosenexus.st"),
                "loading MooseNexus into the fresh Moose image"
              )),
              Effect.zipRight(cacheTrustedMooseRuntime(config, workspace))
            ))
          }

          const typeScriptRunnerCommand = isTypeScriptBuild(config)
            ? yield* runStep(
              progress,
              stepNamed(steps, "typescript-runner"),
              provisionTypeScriptRunner(config, workspace)
            )
            : undefined

          return yield* use(workspace, imagePath, progress, steps, vmPath, typeScriptRunnerCommand)
        }))
      )
    ))
  )
}

const silentProgress: WorkflowProgress = {
  start: () => undefined,
  complete: () => undefined,
  fail: () => undefined,
  skip: () => undefined
}

const stepNamed = (steps: ReadonlyArray<WorkflowStep>, name: string): WorkflowStep => {
  const step = steps.find((each) => each.name === name)
  if (step === undefined) throw new Error(`Unknown workflow step: ${name}`)
  return step
}

const runStep = <A, E, R>(
  progress: WorkflowProgress,
  step: WorkflowStep,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.sync(() => progress.start(step)).pipe(
    Effect.zipRight(Effect.onExit(effect, (exit) => Effect.sync(() => {
      if (Exit.isSuccess(exit)) progress.complete(step)
      else progress.fail(step)
    })))
  )

const writeLoadScript = (config: CliConfig, workspace: Workspace): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await writeFile(join(workspace.scriptsDirectory, "load-moosenexus.st"), loadMooseNexusScript(config))
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const writeBuildScript = (
  config: CliConfig,
  workspace: Workspace,
  typeScriptRunnerCommand: string | undefined,
  resultFile: string | undefined
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      if (config.buildSpec.file === undefined) {
        await writeFile(join(workspace.scriptsDirectory, "build.st"), inlineBuildScript(config, resultFile, typeScriptRunnerCommand))
      } else {
        const specSource = await readFile(resolve(config.buildSpec.file), "utf8")
        await writeFile(join(workspace.scriptsDirectory, "build.st"), externalBuildScript(config, specSource, resultFile, typeScriptRunnerCommand))
      }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const writeModelBuildScript = (
  config: CliConfig,
  workspace: Workspace,
  typeScriptRunnerCommand: string | undefined,
  resultFile: string | undefined
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      const script = config.buildSpec.file === undefined
        ? inlineModelBuildScript(config, resultFile, typeScriptRunnerCommand)
        : externalModelBuildScript(config, await readFile(resolve(config.buildSpec.file), "utf8"), resultFile, typeScriptRunnerCommand)
      await writeFile(join(workspace.scriptsDirectory, "build-model.st"), script)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const writeModelPublishScript = (
  config: CliConfig,
  workspace: Workspace,
  repositoryDirectory: string | undefined,
  resultFile: string | undefined
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: () => writeFile(join(workspace.scriptsDirectory, "publish-model.st"), publishModelScript(config, resultFile, repositoryDirectory)),
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

export const runtimeVmDirectory = (pharoVersion: string): string =>
  join(runtimeDirectory(), "vms", `${majorVersion(pharoVersion)}0-x64`)

export const runtimeImageDirectory = (config: CliConfig): string =>
  join(
    runtimeDirectory(),
    "images",
    `moose-${normalize(config.moose.version)}-pharo-${normalize(config.pharo.version)}-moosenexus-${normalize(config.moosenexus.resolvedRevision ?? config.moosenexus.version)}${isTypeScriptBuild(config) ? "-typescript" : ""}`
  )

const runtimeCacheState = (config: CliConfig): Effect.Effect<RuntimeCacheState, Error> =>
  Effect.tryPromise({
    try: async () => ({
      hasPharoVm: await findPharoExecutable(runtimeVmDirectory(config.pharo.version)) !== undefined,
      hasMooseImage: await findRuntimeImagePromise(runtimeImageDirectory(config)) !== undefined
    }),
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const provisionPharoVm = (config: CliConfig, workspace: Workspace): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const cachedDirectory = runtimeVmDirectory(config.pharo.version)
      const cachedExecutable = await findPharoExecutable(cachedDirectory)
      if (cachedExecutable !== undefined) return cachedExecutable

      await Effect.runPromise(installPharoVm(config, workspace))
      const installedExecutable = await findPharoExecutable(workspace.vmDirectory)
      if (installedExecutable === undefined) {
        throw new Error(`Could not find the Pharo ${config.pharo.version} VM after installation.`)
      }
      await rm(cachedDirectory, { recursive: true, force: true })
      await mkdir(dirname(cachedDirectory), { recursive: true })
      await cp(workspace.vmDirectory, cachedDirectory, { recursive: true })
      return findPharoExecutable(cachedDirectory).then((executable) => {
        if (executable === undefined) throw new Error(`Could not validate cached Pharo ${config.pharo.version} VM.`)
        return executable
      })
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const findPharoExecutable = async (directory: string): Promise<string | undefined> => {
  const candidates = [
    join(directory, "pharo"),
    join(directory, "Pharo.app", "Contents", "MacOS", "Pharo")
  ]
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }
  return undefined
}

const copyTrustedMooseRuntime = (config: CliConfig, workspace: Workspace): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      await rm(workspace.imageDirectory, { recursive: true, force: true })
      await cp(runtimeImageDirectory(config), workspace.imageDirectory, { recursive: true })
      return findImagePromise(workspace.imageDirectory)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const provisionTypeScriptRunner = (config: CliConfig, workspace: Workspace): Effect.Effect<string, Error> => {
  const ts2famix = config.buildSpec.ts2famix
  if (ts2famix === undefined) return Effect.fail(new Error("A TypeScript build requires ts2famix configuration."))

  const directory = join(workspace.toolsDirectory, "ts2famix")
  const executable = join(directory, "dist", "ts2famix-cli-wrapper.js")
  return Effect.tryPromise({
    try: () => rm(directory, { recursive: true, force: true }),
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  }).pipe(
    Effect.zipRight(runCommand("git", ["clone", "--no-checkout", ts2famix.repository, directory], { cwd: workspace.directory })),
    Effect.zipRight(runCommand("git", ["checkout", "--detach", ts2famix.revision], { cwd: directory })),
    Effect.zipRight(runCommand("npm", ["ci", "--ignore-scripts"], { cwd: directory })),
    Effect.zipRight(runCommand("npm", ["run", "build"], { cwd: directory })),
    Effect.as(`${shellQuote(process.execPath)} ${shellQuote(executable)}`)
  )
}

const withTrustedMooseRuntime = <A>(
  config: CliConfig,
  use: (workspace: Workspace, imagePath: string, vmPath: string) => Effect.Effect<A, Error>
): Effect.Effect<A, Error> =>
  withWorkspace(false, (workspace) =>
    Effect.gen(function* () {
      const vmPath = yield* provisionPharoVm(config, workspace)
      const cachedImage = yield* findRuntimeImage(runtimeImageDirectory(config))
      const imagePath = cachedImage ?? (yield* createTrustedMooseRuntime(config, workspace, vmPath))
      return yield* use(workspace, imagePath, vmPath)
    })
  )

const withPharoVm = <A>(
  config: CliConfig,
  use: (workspace: Workspace, vmPath: string) => Effect.Effect<A, Error>
): Effect.Effect<A, Error> =>
  withWorkspace(false, (workspace) =>
    provisionPharoVm(config, workspace).pipe(
      Effect.flatMap((vmPath) => use(workspace, vmPath))
    )
  )

const currentRepositoryRuntimeConfig = (artifactRuntimeConfig: CliConfig): Effect.Effect<CliConfig, Error> =>
  resolveMooseNexusRelease({
    ...defaultCliConfig,
    pharo: artifactRuntimeConfig.pharo,
    moose: artifactRuntimeConfig.moose
  })

const installPulledProject = (
  config: CliConfig,
  projectDirectory: string,
  force: boolean,
  repositoryDirectory: string,
  progress: WorkflowProgress
): Effect.Effect<void, Error> =>
  withTrustedMooseRuntime(config, (workspace, imagePath, vmPath) =>
    Effect.gen(function* () {
      const scriptPath = join(workspace.scriptsDirectory, "install-image-project.st")
      const installOperation = headlessOperationExpectation(workspace, config, "install-project", "install")
      yield* Effect.tryPromise({
        try: () => writeFile(scriptPath, installImageProjectScript(projectDirectory, force, installOperation?.resultPath, repositoryDirectory)),
        catch: (error) => error instanceof Error ? error : new Error(String(error))
      })
      yield* runStep(progress, { name: "install", detail: "Install project metadata with the local MooseNexus runtime" }, runSmalltalk(
        vmPath,
        workspace,
        imagePath,
        scriptPath,
        "installing the pulled project into the selected MooseNexus repository",
        installOperation
      ))
    })
  )

const rebasePulledImage = (
  config: CliConfig,
  imagePath: string,
  coordinates: ProjectCoordinates,
  modelName: string,
  repositoryDirectory: string,
  progress: WorkflowProgress
): Effect.Effect<void, Error> =>
  withPharoVm(config, (workspace, vmPath) =>
    Effect.gen(function* () {
      const scriptPath = join(workspace.scriptsDirectory, "rebase-image-model.st")
      const rebaseOperation = headlessOperationExpectation(workspace, config, "rebase-image-model", "rebase")
      yield* Effect.tryPromise({
        try: () => writeFile(scriptPath, rebaseImageModelScript(coordinates, modelName, rebaseOperation?.resultPath, repositoryDirectory)),
        catch: (error) => error instanceof Error ? error : new Error(String(error))
      })
      yield* runStep(progress, { name: "rebase", detail: "Rebase model sources in the image" }, runSmalltalk(
        vmPath,
        workspace,
        imagePath,
        scriptPath,
        "rebasing the pulled image model sources",
        rebaseOperation
      ))
    })
  )

const createTrustedMooseRuntime = (config: CliConfig, workspace: Workspace, vmPath: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    yield* downloadMooseImage(config, workspace)
    const imagePath = yield* findImage(workspace.imageDirectory)
    yield* writeLoadScript(config, workspace)
    yield* runSmalltalk(
      vmPath,
      workspace,
      imagePath,
      join(workspace.scriptsDirectory, "load-moosenexus.st"),
      "loading MooseNexus into the fresh Moose image"
    )
    yield* cacheTrustedMooseRuntime(config, workspace)
    return yield* findImage(runtimeImageDirectory(config))
  })

const cacheTrustedMooseRuntime = (config: CliConfig, workspace: Workspace): Effect.Effect<void, Error> => {
  const directory = runtimeImageDirectory(config)
  return Effect.tryPromise({
    try: async () => {
      await rm(directory, { recursive: true, force: true })
      await mkdir(dirname(directory), { recursive: true })
      await cp(workspace.imageDirectory, directory, { recursive: true })
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })
}

const findRuntimeImage = (directory: string): Effect.Effect<string | undefined, Error> =>
  Effect.tryPromise({
    try: () => findRuntimeImagePromise(directory),
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const findRuntimeImagePromise = async (directory: string): Promise<string | undefined> =>
  await fileExists(directory) ? findImagePromise(directory) : undefined

const findImagePromise = async (directory: string): Promise<string> => {
  const images = await findFiles(directory, ".image")
  if (images.length !== 1) {
    throw new Error(`Expected exactly one trusted Moose runtime image under ${directory}, found ${images.length}.`)
  }
  return images[0]!
}

const runSmalltalk = (
  vmPath: string,
  workspace: Workspace,
  imagePath: string,
  scriptPath: string,
  action: string,
  expectedResult: HeadlessOperationExpectation | undefined = undefined
): Effect.Effect<void, Error> => {
  const command = runCommand(vmPath, [imagePath, "st", scriptPath], { cwd: workspace.imageDirectory })
  if (expectedResult === undefined) {
    return command.pipe(
      Effect.asVoid,
      Effect.mapError((error) => pharoCommandFailure(action, error))
    )
  }

  return Effect.either(command).pipe(
    Effect.flatMap((commandExit) =>
      readHeadlessResult(expectedResult).pipe(
        Effect.catchAll((error) =>
          Either.isLeft(commandExit)
            ? Effect.fail(pharoCommandFailure(action, commandExit.left))
            : Effect.fail(new Error(`Failed while ${action}: MooseNexus did not write a valid headless result: ${error.message}`))
        ),
        Effect.flatMap((result) => {
          if (result.status === "failure") {
            return Effect.fail(new Error(`Failed while ${action}: ${headlessFailureMessage(result)}`))
          }
          return Either.isLeft(commandExit)
            ? Effect.fail(pharoCommandFailure(action, commandExit.left))
            : Effect.void
        })
      )
    )
  )
}

const headlessOperationExpectation = (
  workspace: Workspace,
  config: CliConfig,
  operation: string,
  phase: string
): HeadlessOperationExpectation | undefined =>
  supportsHeadlessOperationResults(config.moosenexus.version)
    ? { operation, phase, resultPath: join(workspace.resultsDirectory, `${operation}-${phase}.json`) }
    : undefined

const readHeadlessResult = (expected: HeadlessOperationExpectation): Effect.Effect<MooseNexusHeadlessResult, Error> =>
  Effect.tryPromise({
    try: async () => {
      const result = parseHeadlessResult(JSON.parse(await readFile(expected.resultPath, "utf8")))
      if (result.operation !== expected.operation || result.phase !== expected.phase) {
        throw new Error(`expected ${expected.operation}/${expected.phase}, received ${result.operation}/${result.phase}`)
      }
      return result
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const pharoCommandFailure = (action: string, error: CommandFailure): Error =>
  new Error(`Failed while ${action}: ${pharoFailureMessage(error)}`)

export const pharoFailureMessage = (error: CommandFailure): string => {
  const lines = error.output
    .replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
  const descriptionIndex = lines.findIndex(
    (line) => line.startsWith("Error: ") || line.startsWith("Syntax Error") || /^[A-Za-z][A-Za-z0-9]*:\s+/.test(line)
  )

  if (descriptionIndex < 0) {
    return error.exitCode === null
      ? "could not start the Pharo runtime"
      : `Pharo exited with code ${error.exitCode} without a usable diagnostic`
  }

  const messageLines = lines.slice(descriptionIndex)
  const stackFrameIndex = messageLines.findIndex(isPharoStackFrame)

  return (stackFrameIndex < 0 ? messageLines : messageLines.slice(0, stackFrameIndex))
    .map((line, index) =>
      index === 0 && line.startsWith("Error: ") ? line.slice("Error: ".length) : line
    )
    .filter((line) => line !== "")
    .join(" ")
}

const isPharoStackFrame = (line: string): boolean =>
  line.startsWith("Stack frame") || /^[A-Za-z_]\w*(?:\([^)]*\))?>>/.test(line) || /^\[.*\]\s+in\s/.test(line)

const findImage = (directory: string): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const images = await findFiles(directory, ".image")
      if (images.length !== 1) {
        throw new Error(`Expected exactly one Moose image under ${directory}, found ${images.length}.`)
      }
      return images[0]!
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const validatePulledImage = (directory: string): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const reportPath = join(directory, "moosenexus-cli-report.json")
      JSON.parse(await readFile(reportPath, "utf8"))
      const images = await findFiles(directory, ".image")
      if (images.length !== 1) {
        throw new Error(`Expected exactly one Pharo image in ${directory}, found ${images.length}.`)
      }
      return images[0]!
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const imageRuntimeConfig = (directory: string): Effect.Effect<CliConfig, Error> =>
  Effect.tryPromise({
    try: async () => {
      const report = JSON.parse(await readFile(join(directory, "moosenexus-cli-report.json"), "utf8")) as {
        moosenexusRevision?: string
        moosenexusVersion?: string
        mooseVersion?: string
        pharoVersion?: string
      }
      if (report.moosenexusVersion === undefined || report.mooseVersion === undefined || report.pharoVersion === undefined) {
        throw new Error("Image artifact report does not identify its MooseNexus, Moose, and Pharo runtime versions.")
      }
      return {
        ...defaultCliConfig,
        pharo: { version: String(report.pharoVersion) },
        moose: { version: String(report.mooseVersion) },
        moosenexus: {
          ...defaultCliConfig.moosenexus,
          version: String(report.moosenexusVersion),
          revision: String(report.moosenexusRevision ?? `v${report.moosenexusVersion}`),
          resolvedRevision: report.moosenexusRevision
        }
      }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const modelRuntimeConfig = (manifestPath: string): Effect.Effect<CliConfig, Error> =>
  Effect.tryPromise({
    try: async () => {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ModelArtifactManifest
      return runtimeConfigForModelManifest(manifest)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

interface ModelArtifactManifest {
  readonly buildProvenance?: {
    readonly mooseNexusVersion?: string
    readonly mooseVersion?: string
    readonly pharoVersion?: string
  }
}

export const runtimeConfigForModelManifest = (manifest: ModelArtifactManifest): CliConfig => {
  const provenance = manifest.buildProvenance
  if (provenance?.mooseNexusVersion === undefined || provenance.mooseVersion === undefined || provenance.pharoVersion === undefined) {
    throw new Error("Model artifact manifest does not identify its MooseNexus, Moose, and Pharo runtime versions.")
  }

  return {
    ...defaultCliConfig,
    pharo: { version: String(provenance.pharoVersion) },
    moose: { version: String(provenance.mooseVersion) },
    moosenexus: {
      ...defaultCliConfig.moosenexus,
      version: String(provenance.mooseNexusVersion),
      revision: `v${provenance.mooseNexusVersion}`
    }
  }
}

const repositoryProjectDirectory = (rootDirectory: string, coordinates: ProjectCoordinates): string =>
  join(rootDirectory, "pharo-local", "MooseNexus", "repository", coordinates.group, coordinates.name, coordinates.version)

const projectDirectoryInRepository = (repositoryDirectory: string, coordinates: ProjectCoordinates): string =>
  join(repositoryDirectory, "repository", coordinates.group, coordinates.name, coordinates.version)

interface BuildProvenance {
  readonly mooseNexusVersion: string
  readonly mooseVersion: string
  readonly pharoVersion: string
}

interface RecordedProject {
  readonly coordinates: ProjectCoordinates
  readonly directory: string
  readonly modelName: string
  readonly provenance: BuildProvenance
}

const recordedProject = (
  imagePath: string,
  configuredCoordinates: ProjectCoordinates | undefined
): Effect.Effect<RecordedProject, Error> =>
  Effect.tryPromise({
    try: async () => {
      const repositoryDirectory = join(imageLocalRepositoryDirectory(imagePath), "repository")
      const directory = configuredCoordinates === undefined
        ? await singleRecordedProjectDirectory(repositoryDirectory)
        : join(repositoryDirectory, configuredCoordinates.group, configuredCoordinates.name, configuredCoordinates.version)
      const coordinates = configuredCoordinates ?? await recordedProjectCoordinates(directory)

      return {
        coordinates,
        directory,
        ...await recordedModel(directory)
      }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const singleRecordedProjectDirectory = async (repositoryDirectory: string): Promise<string> => {
  const groups = await readdir(repositoryDirectory, { withFileTypes: true })
  const directories = (await Promise.all(groups.filter((entry) => entry.isDirectory()).map(async (group) => {
    const names = await readdir(join(repositoryDirectory, group.name), { withFileTypes: true })
    return (await Promise.all(names.filter((entry) => entry.isDirectory()).map(async (name) => {
      const versions = await readdir(join(repositoryDirectory, group.name, name.name), { withFileTypes: true })
      return versions.filter((entry) => entry.isDirectory()).map((version) =>
        join(repositoryDirectory, group.name, name.name, version.name)
      )
    }))).flat()
  }))).flat()

  if (directories.length !== 1) {
    throw new Error(`Expected exactly one recorded project in ${repositoryDirectory}, found ${directories.length}.`)
  }
  return directories[0]!
}

const recordedProjectCoordinates = async (projectDirectory: string): Promise<ProjectCoordinates> => {
  const properties = JSON.parse(await readFile(join(projectDirectory, "metadata", "properties.json"), "utf8")) as {
    group?: unknown
    name?: unknown
    version?: unknown
  }
  if (typeof properties.group !== "string" || typeof properties.name !== "string" || typeof properties.version !== "string") {
    throw new Error(`Project metadata does not identify coordinates: ${projectDirectory}`)
  }
  return { group: properties.group, name: properties.name, version: properties.version }
}

const imageModelArtifactName = async (projectDirectory: string): Promise<string> => {
  const images = JSON.parse(await readFile(join(projectDirectory, "metadata", "images.json"), "utf8")) as Array<{
    modelArtifact?: string
  }>
  if (images.length !== 1) {
    throw new Error(`Expected exactly one image artifact in ${projectDirectory}, found ${images.length}.`)
  }
  const modelArtifact = images[0]?.modelArtifact
  if (modelArtifact === undefined || modelArtifact === "") {
    throw new Error(`Image metadata in ${projectDirectory} does not identify its model artifact.`)
  }
  return modelArtifact
}

const findInstalledImage = async (directory: string): Promise<string> => {
  const images = await findFiles(directory, ".image")
  if (images.length !== 1) {
    throw new Error(`Expected exactly one installed image artifact under ${directory}, found ${images.length}.`)
  }
  return images[0]!
}

export const defaultAdoptionDirectory = (): string =>
  join(homedir(), "Documents", "Pharo", "images")

const resolveAdoptionDirectory = (directory: string | undefined): string => {
  if (directory === undefined) return defaultAdoptionDirectory()
  if (directory === "~") return homedir()
  if (directory.startsWith("~/")) return join(homedir(), directory.slice(2))
  return resolve(directory)
}

const copyAdoptedImage = async (
  sourceImagePath: string,
  requestedName: string,
  destinationRoot: string
): Promise<AdoptedImageResult> => {
  const name = localImageName(requestedName)
  const destination = join(destinationRoot, name)
  if (await fileExists(destination)) {
    throw new Error(`Cannot adopt image because the destination already exists: ${destination}`)
  }

  await mkdir(destinationRoot, { recursive: true })
  const stagingDirectory = await mkdtemp(join(destinationRoot, ".moosenexus-adopt-"))
  const sourceImageName = basename(sourceImagePath)
  const adoptedImageName = `${name}.image`

  try {
    await copyImageBundleFiles(sourceImagePath, stagingDirectory)
    await makeImageBundleWritable(stagingDirectory)
    if (sourceImageName !== adoptedImageName) {
      await rename(join(stagingDirectory, sourceImageName), join(stagingDirectory, adoptedImageName))
    }

    const sourceChangesName = `${basename(sourceImagePath, extname(sourceImagePath))}.changes`
    const adoptedChangesName = `${name}.changes`
    if (sourceChangesName !== adoptedChangesName && await fileExists(join(stagingDirectory, sourceChangesName))) {
      await rename(join(stagingDirectory, sourceChangesName), join(stagingDirectory, adoptedChangesName))
    }

    await rebaseLauncherMetadata(stagingDirectory, name, adoptedImageName)
    await rename(stagingDirectory, destination)
    return { directory: destination, imagePath: join(destination, adoptedImageName) }
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

const localImageName = (name: string): string => {
  const normalized = name.trim()
  if (normalized === "" || normalized === "." || normalized === ".." || basename(normalized) !== normalized) {
    throw new Error(`Invalid adopted image name: ${name}`)
  }
  return normalized
}

const rebaseLauncherMetadata = async (directory: string, imageDirectoryName: string, imageFileName: string): Promise<void> => {
  const metadataPath = join(directory, "meta-inf.ston")
  if (!(await fileExists(metadataPath))) return

  const metadata = await readFile(metadataPath, "utf8")
  const rebased = metadata.replace(
    /(#imageFile\s*:\s*FileLocator\s*\{\s*#path\s*:\s*RelativePath\s*\[\s*')[^']*(',\s*')[^']*('\s*\])/,
    `$1${imageDirectoryName}$2${imageFileName}$3`
  )
  await writeFile(metadataPath, rebased)
}

const recordedModel = async (projectDirectory: string): Promise<{
  readonly modelName: string
  readonly provenance: BuildProvenance
}> => {
  const manifests = JSON.parse(await readFile(join(projectDirectory, "metadata", "models.json"), "utf8")) as Array<{
    modelArtifact?: { artifactCoordinates?: { name?: string } }
    buildProvenance?: { mooseNexusVersion?: unknown; mooseVersion?: unknown; pharoVersion?: unknown }
  }>
  if (manifests.length !== 1) {
    throw new Error(`Expected exactly one model manifest in ${projectDirectory}, found ${manifests.length}.`)
  }
  const manifest = manifests[0]
  const name = manifest?.modelArtifact?.artifactCoordinates?.name
  if (name === undefined || name === "") {
    throw new Error(`Model metadata in ${projectDirectory} does not identify its model artifact name.`)
  }
  const provenance = manifest?.buildProvenance
  if (
    typeof provenance?.mooseNexusVersion !== "string"
    || typeof provenance.mooseVersion !== "string"
    || typeof provenance.pharoVersion !== "string"
  ) {
    throw new Error(`Model metadata in ${projectDirectory} does not identify its build runtime.`)
  }
  return {
    modelName: name,
    provenance: {
      mooseNexusVersion: provenance.mooseNexusVersion,
      mooseVersion: provenance.mooseVersion,
      pharoVersion: provenance.pharoVersion
    }
  }
}

const modelArtifactName = async (projectDirectory: string): Promise<string> => {
  const manifests = JSON.parse(await readFile(join(projectDirectory, "metadata", "models.json"), "utf8")) as Array<{
    modelArtifact?: { artifactCoordinates?: { name?: string } }
  }>
  if (manifests.length !== 1) {
    throw new Error(`Expected exactly one model manifest in ${projectDirectory}, found ${manifests.length}.`)
  }
  const name = manifests[0]?.modelArtifact?.artifactCoordinates?.name
  if (name === undefined || name === "") {
    throw new Error(`Model metadata in ${projectDirectory} does not identify its model artifact name.`)
  }
  return name
}

const materializeImageArtifact = (
  projectDirectory: string,
  imagePath: string,
  modelName: string,
  readOnly: boolean
): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      const imageDirectory = join(projectDirectory, "artifacts", "images", modelName)
      if (await fileExists(imageDirectory)) await makeImageBundleWritable(imageDirectory)
      await mkdir(imageDirectory, { recursive: true })
      const imageRoot = dirname(imagePath)
      const entries = await readdir(imageRoot, { withFileTypes: true })
      await Promise.all(entries
        .filter((entry) => entry.isFile() && isImageBundleFile(entry.name, imagePath))
        .map((entry) => cp(join(imageRoot, entry.name), join(imageDirectory, entry.name))))
      const catalogPath = join(projectDirectory, "metadata", "images.json")
      const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as Array<{ name: string, modelArtifact: string }>
      const existing = catalog.find((entry) => entry.name === modelName)
      if (existing !== undefined && existing.modelArtifact !== modelName) {
        throw new Error(`Image artifact ${modelName} already refers to model artifact ${existing.modelArtifact}.`)
      }
      if (existing === undefined) {
        catalog.push({ name: modelName, modelArtifact: modelName })
        await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + "\n")
      }
      if (readOnly) await makeImageBundleReadOnly(imageDirectory)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const makeImageBundleWritable = (directory: string): Promise<void> =>
  setImageBundlePermissions(directory, 0o755, 0o644)

const makeImageBundleReadOnly = (directory: string): Promise<void> =>
  setImageBundlePermissions(directory, 0o555, 0o444)

const setImageBundlePermissions = async (directory: string, directoryMode: number, fileMode: number): Promise<void> => {
  await chmod(directory, directoryMode)
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return setImageBundlePermissions(path, directoryMode, fileMode)
    if (entry.isFile()) await chmod(path, fileMode)
  }))
}

const findFilesEffect = (directory: string, extension: string): Effect.Effect<Array<string>, Error> =>
  Effect.tryPromise({
    try: () => findFiles(directory, extension),
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const packageArtifact = (
  config: CliConfig,
  workspace: Workspace,
  imagePath: string,
  provenance: BuildProvenance
): Effect.Effect<string, Error> => {
  const artifactPath = join(workspace.artifactsDirectory, artifactFileName(config))

  return Effect.tryPromise({
    try: async () => {
      const imageBundleFiles = await copyImageBundleFiles(imagePath, workspace.bundleDirectory)

      await writeFile(join(workspace.bundleDirectory, "moosenexus-cli-report.json"), JSON.stringify({
        moosenexusRevision: config.moosenexus.resolvedRevision ?? config.moosenexus.revision,
        moosenexusVersion: provenance.mooseNexusVersion,
        mooseVersion: provenance.mooseVersion,
        pharoVersion: provenance.pharoVersion,
        coordinates: config.buildSpec.coordinates,
        modelName: config.buildSpec.modelName,
        artifact: config.artifact,
        imageBundleFiles,
        mooseNexusRepositoryIncluded: true,
        excludedProjectSourceDirectories: excludedProjectSourceDirectories
      }, null, 2) + "\n")
      await copyRecordedRepository(imageLocalRepositoryDirectory(imagePath), join(workspace.bundleDirectory, "pharo-local", "MooseNexus"))
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  }).pipe(
    Effect.zipRight(runCommand("zip", ["-q", "-r", artifactPath, "."], { cwd: workspace.bundleDirectory })),
    Effect.as(artifactPath)
  )
}

const retainArtifact = (config: CliConfig, artifactPath: string): Effect.Effect<string | undefined, Error> =>
  config.artifact.outputDirectory === undefined
    ? Effect.succeed(undefined)
    : Effect.tryPromise({
        try: async () => {
          const outputPath = artifactOutputPath(config)
          await mkdir(dirname(outputPath), { recursive: true })
          await cp(artifactPath, outputPath)
          return outputPath
        },
        catch: (error) => error instanceof Error ? error : new Error(String(error))
      })

const retainProject = (
  config: CliConfig,
  project: { readonly coordinates: ProjectCoordinates; readonly directory: string },
  force: boolean
): Effect.Effect<string | undefined, Error> =>
  config.artifact.outputDirectory === undefined
    ? Effect.succeed(undefined)
    : Effect.tryPromise({
        try: async () => {
          const destination = join(
            resolve(config.artifact.outputDirectory!),
            project.coordinates.group,
            project.coordinates.name,
            project.coordinates.version
          )
          if (await fileExists(destination)) {
            if (!force) throw new Error(`Cannot export project because the destination already exists: ${destination}`)
            await rm(destination, { recursive: true, force: true })
          }
          await mkdir(dirname(destination), { recursive: true })
          await cp(project.directory, destination, { recursive: true })
          return destination
        },
        catch: (error) => error instanceof Error ? error : new Error(String(error))
      })

const excludedProjectSourceDirectories = [".git"] as const

const copyImageBundleFiles = async (imagePath: string, destinationDirectory: string, force = true): Promise<Array<string>> => {
  const imageDirectory = dirname(imagePath)
  const entries = await readdir(imageDirectory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && isImageBundleFile(entry.name, imagePath))
    .map((entry) => entry.name)

  await Promise.all(files.map(async (file) => {
    const target = join(destinationDirectory, file)
    if (force || !(await fileExists(target))) await cp(join(imageDirectory, file), target)
  }))
  return files.sort()
}

const copyImageArtifactRoot = (imagePath: string, sourceDirectory: string, destinationDirectory: string, force: boolean): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await copyImageBundleFiles(imagePath, destinationDirectory, force)
      const report = join(sourceDirectory, "moosenexus-cli-report.json")
      const targetReport = join(destinationDirectory, "moosenexus-cli-report.json")
      if (force || !(await fileExists(targetReport))) await cp(report, targetReport)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

export const isImageBundleFile = (fileName: string, imagePath: string): boolean => {
  const imageName = basename(imagePath)
  const changesName = imagePath.slice(0, -extname(imagePath).length) + ".changes"
  return fileName === imageName
    || fileName === basename(changesName)
    || fileName.endsWith(".sources")
    || fileName === "meta-inf.ston"
    || fileName === "pharo.version"
}

const copyRecordedRepository = (sourceDirectory: string, destinationDirectory: string): Promise<void> =>
  cp(sourceDirectory, destinationDirectory, {
    recursive: true,
    filter: (source) => shouldCopyRecordedRepositoryPath(sourceDirectory, source)
  })

const imageLocalRepositoryDirectory = (imagePath: string): string =>
  join(dirname(imagePath), "pharo-local", "MooseNexus")

export const shouldCopyRecordedRepositoryPath = (repositoryRoot: string, path: string): boolean => {
  const relativePath = relative(repositoryRoot, path)
  if (relativePath === "") return true
  return !relativePath.split(sep).some((segment) => excludedProjectSourceDirectories.includes(segment as typeof excludedProjectSourceDirectories[number]))
}

const publishArtifact = (config: CliConfig, artifactPath: string): Effect.Effect<string | undefined, Error> => {
  if (config.oci === undefined) return Effect.succeed(undefined)

  const reference = ociReference(config)
  const coordinates = config.buildSpec.coordinates!
  const arguments_ = [
    "push",
    "--artifact-type", "application/vnd.moosenexus.pharo-image.v1+zip",
    "--annotation", `org.moosenexus.project.group=${coordinates.group}`,
    "--annotation", `org.moosenexus.project.name=${coordinates.name}`,
    "--annotation", `org.moosenexus.project.version=${coordinates.version}`,
    reference,
    `${basename(artifactPath)}:application/vnd.moosenexus.pharo-image.v1+zip`
  ]

  return runCommand("oras", arguments_, { cwd: dirname(artifactPath) }).pipe(Effect.as(reference))
}

const findFiles = async (directory: string, extension: string): Promise<Array<string>> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findFiles(path, extension)
    return entry.isFile() && path.endsWith(extension) ? [path] : []
  }))
  return nested.flat()
}

const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch (error) {
    if (isNotFoundError(error)) return false
    throw error
  }
}

const specSummary = (config: CliConfig): string => {
  if (config.buildSpec.file !== undefined) return config.buildSpec.file
  const coordinates = config.buildSpec.coordinates
  return coordinates === undefined
    ? "CLI inputs"
    : `${coordinates.group}:${coordinates.name}:${coordinates.version} from ${config.buildSpec.sourceDirectory}`
}

const extractorDescription = (config: CliConfig): string => {
  if (config.buildSpec.verveineJ !== undefined) return config.buildSpec.verveineJ.runner
  if (isTypeScriptBuild(config)) return "local ts2famix"
  return config.buildSpec.language === "java" ? "docker (language default)" : "language default"
}

const isTypeScriptBuild = (config: CliConfig): boolean =>
  config.buildSpec.language === "typescript"

const majorVersion = (version: string): string => version.split(".")[0] ?? version

const normalize = (value: string): string => value.toLowerCase().replaceAll(/[^a-z0-9._-]/g, "-")
