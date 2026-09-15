import { Effect, Option } from "effect"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { CliConfig } from "./config.js"
import { defaultCliConfig } from "./config.js"
import { resolveProjectCoordinates } from "./coordinates.js"
import { resolveExtractorConfiguration } from "./extractors.js"
import { supportedLanguages } from "./languages.js"
import { normalizeMooseVersion } from "./versions.js"

export interface BuildImageCommandInput {
  readonly config: Option.Option<CliConfig>
  readonly dryRun: boolean
  readonly pharoVersion: Option.Option<string>
  readonly pharoVmUrl: Option.Option<string>
  readonly mooseVersion: Option.Option<string>
  readonly mooseImageUrl: Option.Option<string>
  readonly mooseNexusRepository: Option.Option<string>
  readonly mooseNexusVersion: Option.Option<string>
  readonly specFile: Option.Option<string>
  readonly coordinates: Option.Option<string>
  readonly projectGroup: Option.Option<string>
  readonly projectName: Option.Option<string>
  readonly projectVersion: Option.Option<string>
  readonly sourceDirectory: Option.Option<string>
  readonly projectKind: Option.Option<"auto" | "managed" | "unmanaged">
  readonly language: Option.Option<string>
  readonly dependencyDirectory: Option.Option<string>
  readonly modelName: Option.Option<string>
  readonly description: Option.Option<string>
  readonly outputDirectory: Option.Option<string>
  readonly noInstall: boolean
  readonly keepWorkspace: boolean
  readonly ociRegistry: Option.Option<string>
  readonly ociNamespace: Option.Option<string>
}

export const resolveBuildImageConfig = (
  input: BuildImageCommandInput,
  extractorArguments: ReadonlyArray<string> = []
): Effect.Effect<CliConfig, Error> =>
  resolveBuildConfig(input, extractorArguments, true)

const resolveBuildConfig = (
  input: BuildImageCommandInput,
  extractorArguments: ReadonlyArray<string>,
  requiresPublicationCoordinates: boolean
): Effect.Effect<CliConfig, Error> =>
  Effect.gen(function* () {
    const base = Option.getOrElse(input.config, () => defaultCliConfig)
    const language = normalizeLanguage(optionOrUndefined(input.language, base.buildSpec.language))
    const extractors = yield* Effect.try({
      try: () => resolveExtractorConfiguration(language, extractorArguments, base.buildSpec),
      catch: (error) => error instanceof Error ? error : new Error(String(error))
    })
    const coordinates = yield* Effect.try({
      try: () => resolveCoordinates(input, base),
      catch: (error) => error instanceof Error ? error : new Error(String(error))
    })
    const resolved: CliConfig = {
      ...base,
      pharo: {
        ...base.pharo,
        version: optionOr(input.pharoVersion, base.pharo.version),
        vmUrl: optionOrUndefined(input.pharoVmUrl, base.pharo.vmUrl)
      },
      moose: {
        ...base.moose,
        version: normalizeMooseVersion(optionOr(input.mooseVersion, base.moose.version)),
        imageUrl: optionOrUndefined(input.mooseImageUrl, base.moose.imageUrl)
      },
      moosenexus: {
        ...base.moosenexus,
        repository: optionOr(input.mooseNexusRepository, base.moosenexus.repository),
        version: optionOr(input.mooseNexusVersion, base.moosenexus.version)
      },
      buildSpec: {
        ...base.buildSpec,
        file: optionOrUndefined(input.specFile, base.buildSpec.file),
        coordinates,
        sourceDirectory: resolveProjectPath(optionOrUndefined(input.sourceDirectory, base.buildSpec.sourceDirectory)),
        projectKind: optionOr(input.projectKind, base.buildSpec.projectKind),
        language,
        dependencyDirectory: resolveProjectPath(optionOrUndefined(input.dependencyDirectory, base.buildSpec.dependencyDirectory)),
        modelName: optionOrUndefined(input.modelName, base.buildSpec.modelName),
        description: optionOrUndefined(input.description, base.buildSpec.description),
        verveineJ: extractors.verveineJ,
        ts2famix: extractors.ts2famix
      },
      artifact: {
        ...base.artifact,
        outputDirectory: optionOr(input.outputDirectory, base.artifact.outputDirectory)
      },
      oci: resolveOci(input, base)
    }

    yield* validateBuildSpec(resolved)
    if (requiresPublicationCoordinates) yield* validatePublication(resolved)
    yield* validateExecutionOptions(input, resolved)
    return resolved
  })

export const resolveBuildModelConfig = (
  input: BuildImageCommandInput,
  extractorArguments: ReadonlyArray<string> = []
): Effect.Effect<CliConfig, Error> =>
  resolveBuildConfig(input, extractorArguments, false).pipe(
    Effect.tap((config) => Effect.try({
      try: () => {
        if (config.buildSpec.file !== undefined && config.buildSpec.coordinates !== undefined) {
          throw new Error("A build-model spec defines its own coordinates; do not also provide --project-group, --project-name, or --project-version.")
        }
      },
      catch: (error) => error instanceof Error ? error : new Error(String(error))
    }))
  )

export const validateBuildRuntime = (config: CliConfig): Effect.Effect<CliConfig, Error> =>
  Effect.try({
    try: () => {
      if (config.buildSpec.language === "typescript" && Number(config.moose.version.split(".")[0]) < 13) {
        throw new Error(`TypeScript support requires Moose 13 or later. Resolved Moose version: ${config.moose.version}.`)
      }
      if (config.buildSpec.dependencyDirectory !== undefined && Number(config.moosenexus.version.replace(/^v/, "").split(".")[0]) < 1) {
        throw new Error(`--dependency-directory requires MooseNexus 1.0.0 or later. Resolved MooseNexus version: ${config.moosenexus.version}.`)
      }
      return config
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const optionOr = <A>(option: Option.Option<A>, fallback: A): A =>
  Option.getOrElse(option, () => fallback)

const optionOrUndefined = <A>(option: Option.Option<A>, fallback: A | undefined): A | undefined =>
  Option.match(option, {
    onNone: () => fallback,
    onSome: (value) => value
  })

const normalizeLanguage = (language: string | undefined): string | undefined =>
  language?.trim().toLowerCase()

const resolveProjectPath = (path: string | undefined): string | undefined => {
  if (path === undefined) return undefined
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return resolve(path)
}

const resolveCoordinates = (input: BuildImageCommandInput, base: CliConfig): CliConfig["buildSpec"]["coordinates"] => {
  return resolveProjectCoordinates(
    optionOrUndefined(input.coordinates, undefined),
    {
      group: optionOrUndefined(input.projectGroup, undefined),
      name: optionOrUndefined(input.projectName, undefined),
      version: optionOrUndefined(input.projectVersion, undefined)
    },
    base.buildSpec.coordinates
  )
}

const validateBuildSpec = (config: CliConfig): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => {
      if (config.buildSpec.file !== undefined) {
        if (config.buildSpec.verveineJ !== undefined) {
          throw new Error("An external build spec script configures its own extractor; do not also configure buildSpec.verveineJ.")
        }
        if (config.buildSpec.description !== undefined) {
          throw new Error("An external build spec script configures its own model description; do not also configure buildSpec.description.")
        }
      }

      if (config.buildSpec.file === undefined) {
        const missing = [
          ["project-group", config.buildSpec.coordinates?.group],
          ["project-name", config.buildSpec.coordinates?.name],
          ["project-version", config.buildSpec.coordinates?.version],
          ["source", config.buildSpec.sourceDirectory]
        ]
          .filter(([, value]) => value === undefined || value === "")
          .map(([field]) => `--${field}`)

        if (missing.length > 0) {
          throw new Error(`Missing CLI build spec inputs: ${missing.join(", ")}. Provide them or pass --spec.`)
        }

        if (config.buildSpec.projectKind === "unmanaged" && (config.buildSpec.language === undefined || config.buildSpec.language === "")) {
          throw new Error("An unmanaged project requires --language.")
        }

        if (config.buildSpec.dependencyDirectory !== undefined && config.buildSpec.projectKind !== "unmanaged") {
          throw new Error("--dependency-directory requires --kind unmanaged.")
        }
      }

      if (config.buildSpec.verveineJ !== undefined) {
        if (config.buildSpec.language !== "java") {
          throw new Error("VerveineJ options require --language java.")
        }
        if (config.buildSpec.verveineJ.runner === "local" && (config.buildSpec.verveineJ.directory === undefined || config.buildSpec.verveineJ.directory === "")) {
          throw new Error("--runner local requires --directory after --.")
        }
        if (config.buildSpec.verveineJ.runner === "local" && config.buildSpec.verveineJ.version !== undefined) {
          throw new Error("--version after -- applies only to --runner docker.")
        }
      }

      if (config.buildSpec.ts2famix !== undefined && config.buildSpec.language !== "typescript") {
        throw new Error("ts2famix options require --language typescript.")
      }

      if (config.buildSpec.language !== undefined && !supportedLanguages.includes(config.buildSpec.language as typeof supportedLanguages[number])) {
        throw new Error(`Unsupported language: ${config.buildSpec.language}. Supported languages: ${supportedLanguages.join(", ")}.`)
      }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const validatePublication = (config: CliConfig): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => {
      if (config.oci !== undefined && config.buildSpec.coordinates === undefined) {
        throw new Error("OCI publication requires project coordinates. Provide them in buildSpec.coordinates or with --project-group, --project-name, and --project-version.")
      }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const validateExecutionOptions = (input: BuildImageCommandInput, config: CliConfig): Effect.Effect<void, Error> =>
  Effect.try({
    try: () => {
      if (input.dryRun && input.keepWorkspace) {
        throw new Error("--keep cannot be used with --dry-run because a dry run does not create a workspace.")
      }
      if (input.noInstall && config.artifact.outputDirectory === undefined && config.oci === undefined) {
        throw new Error("--no-install requires --out or an OCI registry and namespace.")
      }
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })

const resolveOci = (input: BuildImageCommandInput, base: CliConfig): CliConfig["oci"] => {
  const registry = optionOrUndefined(input.ociRegistry, base.oci?.registry)
  const namespace = optionOrUndefined(input.ociNamespace, base.oci?.namespace)

  if (registry === undefined && namespace === undefined) {
    return base.oci
  }

  if (registry === undefined || registry.length === 0 || namespace === undefined || namespace.length === 0) {
    throw new Error("OCI publication requires both --registry and --namespace, or equivalent config values.")
  }

  return { registry, namespace }
}
