#!/usr/bin/env node

import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Option } from "effect"
import * as EffectConsole from "effect/Console"
import { resolveBuildImageConfig, resolveBuildModelConfig, validateBuildRuntime } from "./build-input.js"
import { cliErrorMessage, formatCliDiagnostic, formatCliError } from "./cli-error.js"
import { CliConfig } from "./config.js"
import { resolveProjectCoordinates, type ProjectCoordinates } from "./coordinates.js"
import { helpForArguments } from "./help.js"
import { supportedLanguages } from "./languages.js"
import { listArtifacts, renderArtifacts } from "./artifacts.js"
import { CliWorkflowProgress } from "./progress.js"
import { resolveMooseNexusRelease, resolveMooseRuntimeRelease } from "./releases.js"
import { cliVersion } from "./version.js"
import { isWizardRequest, runWizard } from "./wizard.js"
import { executeBuildImage, executeBuildModel, executeImageAdoption, imageOciReference, modelOciReferenceForCoordinates, planBuildImage, planBuildModel, pullImage, pullModel, renderAdoptImageResult, renderAdoptImageStart, renderBuildModelResult, renderBuildResult, renderBuildStart, renderModelBuildStart, renderModelPlan, renderPlan, renderPullModelResult, renderPullModelStart, renderPullResult, renderPullStart, type ImageAdoption } from "./workflow.js"

const splitExtractorArguments = (arguments_: ReadonlyArray<string>): {
  readonly main: ReadonlyArray<string>
  readonly extractor: ReadonlyArray<string>
} => {
  const separator = arguments_.indexOf("--")
  return separator === -1
    ? { main: arguments_, extractor: [] }
    : { main: arguments_.slice(0, separator), extractor: arguments_.slice(separator + 1) }
}

const config = Options.fileSchema("config", CliConfig, "yaml").pipe(
  Options.withAlias("c"),
  Options.optional,
  Options.withDescription("Path to the MooseNexus CLI YAML configuration file")
)

const pharoVersion = Options.text("pharo").pipe(
  Options.optional,
  Options.withDescription("Pharo version used by the Moose image")
)

const pharoVmUrl = Options.text("vm-url").pipe(
  Options.optional,
  Options.withDescription("URL of the Pharo VM bootstrap script")
)

const mooseVersion = Options.text("moose").pipe(
  Options.optional,
  Options.withDescription("Moose image version")
)

const mooseImageUrl = Options.text("image-url").pipe(
  Options.optional,
  Options.withDescription("URL of the fresh Moose image archive")
)

const mooseNexusRepository = Options.text("repository").pipe(
  Options.optional,
  Options.withDescription("MooseNexus repository to load into the image")
)

const mooseNexusVersion = Options.text("nexus-version").pipe(
  Options.optional,
  Options.withDescription("MooseNexus release version, floating track, or latest")
)

const specFile = Options.file("spec").pipe(
  Options.optional,
  Options.withDescription("Smalltalk script that builds and imports a MooseNexus model before saving the image")
)

const coordinates = Args.optional(Args.text({ name: "coordinates" }))

const projectGroup = Options.text("project-group").pipe(
  Options.optional,
  Options.withDescription("MooseNexus project coordinate group")
)

const projectName = Options.text("project-name").pipe(
  Options.optional,
  Options.withDescription("MooseNexus project coordinate name")
)

const projectVersion = Options.text("project-version").pipe(
  Options.optional,
  Options.withDescription("MooseNexus project coordinate version")
)

const sourceDirectory = Options.text("source").pipe(
  Options.optional,
  Options.withDescription("Source project directory to model")
)

const projectKind = Options.choice("kind", ["auto", "managed", "unmanaged"] as const).pipe(
  Options.optional,
  Options.withDescription("How MooseNexus should import the project")
)

const language = Options.choice("language", supportedLanguages).pipe(
  Options.optional,
  Options.withDescription("Language to use when the project is imported as unmanaged")
)

const dependencyDirectory = Options.text("dependency-directory").pipe(
  Options.optional,
  Options.withDescription("Directory containing local JAR dependencies for an unmanaged project")
)

const modelName = Options.text("model-name").pipe(
  Options.optional,
  Options.withDescription("Name assigned to the produced Moose model")
)

const description = Options.text("description").pipe(
  Options.optional,
  Options.withDescription("Description recorded with the produced model artifact")
)

const outputDirectory = Options.text("out").pipe(
  Options.optional,
  Options.withDescription("Directory where the completed image artifact is retained")
)

const keepWorkspace = Options.boolean("keep", { ifPresent: true }).pipe(
  Options.withDescription("Keep the generated temporary workspace after the build")
)

const noInstall = Options.boolean("no-install", { ifPresent: true }).pipe(
  Options.withDescription("Do not install the build result into the local MooseNexus repository")
)

const ociRegistry = Options.text("registry").pipe(
  Options.optional,
  Options.withDescription("OCI registry host")
)

const ociNamespace = Options.text("namespace").pipe(
  Options.optional,
  Options.withDescription("OCI registry namespace")
)

const dryRun = Options.boolean("dry-run", { ifPresent: true }).pipe(
  Options.withDescription("Print the resolved workflow plan without executing it")
)

const refresh = Options.boolean("refresh", { ifPresent: true }).pipe(
  Options.withDescription("Refresh cached floating and latest release references")
)

const pullProjectGroup = Options.text("project-group").pipe(
  Options.optional,
  Options.withDescription("MooseNexus project coordinate group")
)

const pullProjectName = Options.text("project-name").pipe(
  Options.optional,
  Options.withDescription("MooseNexus project coordinate name")
)

const pullProjectVersion = Options.text("project-version").pipe(
  Options.optional,
  Options.withDescription("MooseNexus project coordinate version")
)

const pullRegistry = Options.text("registry").pipe(
  Options.withDescription("OCI registry host")
)

const pullNamespace = Options.text("namespace").pipe(
  Options.withDescription("OCI registry namespace")
)

const pullOutputDirectory = Options.text("out").pipe(
  Options.optional,
  Options.withDescription("Directory where the image artifact is unpacked")
)

const force = Options.boolean("force", { ifPresent: true }).pipe(
  Options.withDescription("Replace a conflicting repository artifact or export")
)

const adopt = Options.boolean("adopt", { ifPresent: true }).pipe(
  Options.withDescription("Copy the installed image artifact into the default Pharo images directory")
)

const adoptAs = Options.text("adopt-as").pipe(
  Options.optional,
  Options.withDescription("Local name for an adopted image")
)

const adoptTo = Options.text("adopt-to").pipe(
  Options.optional,
  Options.withDescription("Directory in which to create an adopted image")
)

const json = Options.boolean("json", { ifPresent: true }).pipe(
  Options.withDescription("Write machine-readable JSON")
)

const buildOptions = {
  config,
  dryRun,
  refresh,
  pharoVersion,
  pharoVmUrl,
  mooseVersion,
  mooseImageUrl,
  mooseNexusRepository,
  mooseNexusVersion,
  specFile,
  coordinates,
  projectGroup,
  projectName,
  projectVersion,
  sourceDirectory,
  projectKind,
  language,
  dependencyDirectory,
  modelName,
  description,
  outputDirectory,
  noInstall,
  force,
  keepWorkspace,
  ociRegistry,
  ociNamespace
}

const buildImage = (extractorArguments: ReadonlyArray<string>) => Command.make(
  "build-image",
  { ...buildOptions, adopt, adoptAs, adoptTo },
  (input) =>
  Effect.gen(function* () {
      const config = yield* resolveBuildImageConfig(input, extractorArguments).pipe(
        Effect.flatMap((config) => resolveMooseRuntimeRelease(config, { refresh: input.refresh })),
        Effect.flatMap((config) => resolveMooseNexusRelease(config, { refresh: input.refresh })),
        Effect.flatMap((config) => validateBuildRuntime(config))
      )
      const plan = yield* planBuildImage(config, { install: !input.noInstall })
    yield* Console.log(input.dryRun ? renderPlan(plan) : renderBuildStart(plan))

    if (!input.dryRun) {
      const adoption = imageAdoption(input)
      if (input.noInstall && adoption !== undefined) {
        return yield* Effect.fail(new Error("Image adoption requires installation; omit --no-install."))
      }
      const result = yield* executeBuildImage(config, {
        force: input.force,
        install: !input.noInstall,
        keepWorkspace: input.keepWorkspace,
        progress: new CliWorkflowProgress(),
        ...(adoption === undefined ? {} : { adoption })
      })
      yield* Console.log("")
      yield* Console.log(renderBuildResult(result))
    }
  })
)

const buildModel = (extractorArguments: ReadonlyArray<string>) => Command.make(
  "build-model",
  buildOptions,
  (input) =>
    Effect.gen(function* () {
      const config = yield* resolveBuildModelConfig(input, extractorArguments).pipe(
        Effect.flatMap((config) => resolveMooseRuntimeRelease(config, { refresh: input.refresh })),
        Effect.flatMap((config) => resolveMooseNexusRelease(config, { refresh: input.refresh })),
        Effect.flatMap((config) => validateBuildRuntime(config))
      )
      const plan = yield* planBuildModel(config, { install: !input.noInstall })
      yield* Console.log(input.dryRun ? renderModelPlan(plan) : renderModelBuildStart(plan))

      if (!input.dryRun) {
        const result = yield* executeBuildModel(config, {
          force: input.force,
          install: !input.noInstall,
          keepWorkspace: input.keepWorkspace,
          progress: new CliWorkflowProgress()
        })
        yield* Console.log("")
        yield* Console.log(renderBuildModelResult(result))
      }
    })
)

const pullImageCommand = Command.make(
  "pull-image",
  {
    coordinates,
    projectGroup: pullProjectGroup,
    projectName: pullProjectName,
    projectVersion: pullProjectVersion,
    registry: pullRegistry,
    namespace: pullNamespace,
    outputDirectory: pullOutputDirectory,
    force,
    adopt,
    adoptAs,
    adoptTo
  },
  (input) =>
    Effect.gen(function* () {
      const coordinates = yield* resolvePullCoordinates(input)
      const reference = imageOciReference(input.registry, input.namespace, coordinates)
      const outputDirectory = Option.getOrUndefined(input.outputDirectory)
      const adoption = imageAdoption(input)
      yield* Console.log(renderPullStart(reference, outputDirectory, adoption))

      const result = yield* pullImage(reference, coordinates, outputDirectory, input.force, adoption, new CliWorkflowProgress())
      yield* Console.log("")
      yield* Console.log(renderPullResult(result))
    })
)

const adoptImageCommand = Command.make(
  "adopt-image",
  {
    coordinates,
    projectGroup: pullProjectGroup,
    projectName: pullProjectName,
    projectVersion: pullProjectVersion,
    adoptAs,
    adoptTo
  },
  (input) =>
    Effect.gen(function* () {
      const coordinates = yield* resolvePullCoordinates(input)
      const adoption = imageAdoption(input) ?? {}
      yield* Console.log(renderAdoptImageStart(coordinates, adoption))

      const result = yield* executeImageAdoption(coordinates, adoption, new CliWorkflowProgress())
      yield* Console.log("")
      yield* Console.log(renderAdoptImageResult(result))
    })
)

const artifactsCommand = Command.make(
  "artifacts",
  { json },
  (input) =>
    Effect.tryPromise(() => listArtifacts()).pipe(
      Effect.mapError((error) => error instanceof Error ? error : new Error(String(error))),
      Effect.flatMap((artifacts) => Console.log(
        input.json
          ? JSON.stringify(artifacts, null, 2)
          : renderArtifacts(artifacts)
      ))
    )
)

const pullModelCommand = Command.make(
  "pull-model",
  {
    coordinates,
    projectGroup: pullProjectGroup,
    projectName: pullProjectName,
    projectVersion: pullProjectVersion,
    registry: pullRegistry,
    namespace: pullNamespace,
    force
  },
  (input) =>
    Effect.gen(function* () {
      const coordinates = yield* resolvePullCoordinates(input)
      const reference = modelOciReferenceForCoordinates(input.registry, input.namespace, coordinates)
      yield* Console.log(renderPullModelStart(reference))

      const result = yield* pullModel(reference, input.force, new CliWorkflowProgress())
      yield* Console.log("")
      yield* Console.log(renderPullModelResult(result))
    })
)

const pullCoordinates = (input: {
  readonly coordinates: Option.Option<string>
  readonly projectGroup: Option.Option<string>
  readonly projectName: Option.Option<string>
  readonly projectVersion: Option.Option<string>
}): ProjectCoordinates => {
  const resolved = resolveProjectCoordinates(
    Option.getOrUndefined(input.coordinates),
    {
      group: Option.getOrUndefined(input.projectGroup),
      name: Option.getOrUndefined(input.projectName),
      version: Option.getOrUndefined(input.projectVersion)
    },
    undefined
  )

  if (resolved === undefined || resolved.group === "" || resolved.name === "" || resolved.version === "") {
    throw new Error("A project coordinate is required. Provide <group>:<name>:<version> or --project-group, --project-name, and --project-version.")
  }

  return resolved
}

const resolvePullCoordinates = (input: {
  readonly coordinates: Option.Option<string>
  readonly projectGroup: Option.Option<string>
  readonly projectName: Option.Option<string>
  readonly projectVersion: Option.Option<string>
}): Effect.Effect<ProjectCoordinates, Error> =>
  Effect.try({
    try: () => pullCoordinates(input),
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const imageAdoption = (input: {
  readonly adopt?: boolean
  readonly adoptAs: Option.Option<string>
  readonly adoptTo: Option.Option<string>
}): ImageAdoption | undefined => {
  const name = Option.getOrUndefined(input.adoptAs)
  const destinationDirectory = Option.getOrUndefined(input.adoptTo)
  if (input.adopt !== true && name === undefined && destinationDirectory === undefined) return undefined

  return {
    ...(name === undefined ? {} : { name }),
    ...(destinationDirectory === undefined ? {} : { destinationDirectory })
  }
}

const runCli = (arguments_: ReadonlyArray<string>, extractorArguments: ReadonlyArray<string> = []) => {
  const command = Command.make("moosenexus").pipe(Command.withSubcommands([
    buildImage(extractorArguments),
    buildModel(extractorArguments),
    pullImageCommand,
    pullModelCommand,
    adoptImageCommand,
    artifactsCommand
  ]))
  const cli = Command.run(command, { name: "MooseNexus CLI", version: cliVersion })
  return EffectConsole.consoleWith((console) =>
    cli(arguments_).pipe(
      EffectConsole.withConsole({
        ...console,
        error: (...values) => console.error(formatCliDiagnostic(values, Boolean(process.stderr.isTTY)))
      }),
      Effect.catchAll(reportCliError)
    )
  )
}

const reportCliError = (error: unknown) => {
  process.exitCode = 1
  const message = cliErrorMessage(error)
  return message === undefined ? Effect.void : Console.error(formatCliError(message, Boolean(process.stderr.isTTY)))
}

const invocation = splitExtractorArguments(process.argv.slice(2))
const help = helpForArguments(invocation.main)
if (help !== undefined) {
  process.stdout.write(`${help}\n`)
} else if (isWizardRequest(invocation.main)) {
  Effect.tryPromise({
    try: () => runWizard({ expert: invocation.main.includes("--expert") }),
    catch: (cause) => new Error("Could not complete the wizard", { cause })
  }).pipe(
    Effect.flatMap((result) => {
      if (result.cancelled) return Console.log("Wizard cancelled.")
      if (!result.run) return Console.log("No command was run.")
      const wizardInvocation = splitExtractorArguments(result.arguments)
      return runCli(["node", "moosenexus", ...wizardInvocation.main], wizardInvocation.extractor)
    }),
    Effect.catchAll(reportCliError),
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain
  )
} else {
  runCli([process.argv[0] ?? "node", process.argv[1] ?? "moosenexus", ...invocation.main], invocation.extractor).pipe(
    Effect.provide(NodeContext.layer),
    NodeRuntime.runMain
  )
}
