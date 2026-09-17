import * as Prompt from "@effect/cli/Prompt"
import * as Terminal from "@effect/platform/Terminal"
import * as NodeContext from "@effect/platform-node/NodeContext"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { stdout } from "node:process"
import type { ProjectCoordinates } from "./coordinates.js"
import { runExtractorWizard } from "./extractors.js"
import { supportedLanguages } from "./languages.js"
import { defaultAdoptedImageName } from "./workflow.js"

interface WizardCommand {
  readonly arguments: ReadonlyArray<string>
  readonly cancelled: false
  readonly run: boolean
}

export interface WizardCancellation {
  readonly cancelled: true
}

export type WizardResult = WizardCommand | WizardCancellation

export const isWizardRequest = (arguments_: ReadonlyArray<string>): boolean =>
  arguments_.includes("--wizard") || arguments_.includes("-w")

export const runWizard = async ({ expert = false }: { readonly expert?: boolean } = {}): Promise<WizardResult> => {
  try {
    const command = await askChoice("Command", ["build-image", "build-model", "pull-image", "pull-model", "adopt-image", "artifacts"])
    const arguments_ = command === "build-image"
      ? await buildImageArguments(expert)
      : command === "build-model"
        ? await buildModelArguments(expert)
        : command === "pull-image"
          ? await pullImageArguments()
          : command === "pull-model"
            ? await pullModelArguments()
            : command === "adopt-image"
              ? await adoptImageArguments()
              : ["artifacts"]

    if (command === "artifacts") return { arguments: arguments_, cancelled: false, run: true }

    const commandLine = ["moosenexus", ...arguments_].map(shellQuote).join(" ")
    stdout.write(`\nCommand: ${commandLine}\n`)
    const run = await askBoolean("Run this command", true)
    return { arguments: arguments_, cancelled: false, run }
  } catch (error) {
    if (isWizardCancellation(error)) return { cancelled: true }
    throw error
  }
}

export const isWizardCancellation = (error: unknown): boolean =>
  Terminal.isQuitException(error) || (error instanceof Error && error.name === "AbortError")

const buildImageArguments = async (expert: boolean): Promise<Array<string>> => {
  const input = await askChoice("Build input", ["inline", "spec", "config"])
  const arguments_: Array<string> = ["build-image"]
  let language: string | undefined

  if (input === "config") {
    arguments_.push("--config", await askRequired("Configuration file"))
  } else if (input === "spec") {
    arguments_.push("--spec", await askRequired("Smalltalk build script"))
  } else {
    const projectGroup = await askRequired("Project group")
    const projectName = await askRequired("Project name")
    arguments_.push(
      `${projectGroup}:${projectName}:${await askRequired("Project version")}`,
      "--source", await askRequired("Source directory")
    )
    const kind = await askChoice("Project kind", ["auto", "managed", "unmanaged"])
    appendWhenChanged(arguments_, "--kind", kind, "auto")
    language = await askChoice("Language", supportedLanguages)
    arguments_.push("--language", language)
    if (kind === "unmanaged") appendWhenPresent(arguments_, "--dependency-directory", await askBlank("Local JAR directory", "none"))
    appendWhenChanged(arguments_, "--model-name", await askWithDefault("Model name", projectName), projectName)
    appendWhenPresent(arguments_, "--description", await askBlank("Model description", "none"))
  }

  if (input !== "config") {
    await appendRuntimeArguments(arguments_, expert)
    await appendBuildOutputArguments(arguments_)
    await appendOciArguments(arguments_)
  }

  await appendBuildImageAdoption(arguments_)

  const dryRun = await askBoolean("Dry run", false)
  if (dryRun) {
    arguments_.push("--dry-run")
  } else if (expert && await askBoolean("Keep workspace", false)) {
    arguments_.push("--keep")
  }
  await appendExtractorArguments(arguments_, language)
  return arguments_
}

const buildModelArguments = async (expert: boolean): Promise<Array<string>> => {
  const input = await askChoice("Build input", ["inline", "spec", "config"])
  const arguments_: Array<string> = ["build-model"]
  let language: string | undefined

  if (input === "config") {
    arguments_.push("--config", await askRequired("Configuration file"))
  } else if (input === "spec") {
    arguments_.push("--spec", await askRequired("Smalltalk build spec"))
  } else {
    const projectGroup = await askRequired("Project group")
    const projectName = await askRequired("Project name")
    arguments_.push(
      `${projectGroup}:${projectName}:${await askRequired("Project version")}`,
      "--source", await askRequired("Source directory")
    )
    const kind = await askChoice("Project kind", ["auto", "managed", "unmanaged"])
    appendWhenChanged(arguments_, "--kind", kind, "auto")
    language = await askChoice("Language", supportedLanguages)
    arguments_.push("--language", language)
    if (kind === "unmanaged") appendWhenPresent(arguments_, "--dependency-directory", await askBlank("Local JAR directory", "none"))
    appendWhenChanged(arguments_, "--model-name", await askWithDefault("Model name", projectName), projectName)
    appendWhenPresent(arguments_, "--description", await askBlank("Model description", "none"))
  }

  if (input !== "config") {
    await appendRuntimeArguments(arguments_, expert)
    await appendBuildOutputArguments(arguments_)
    await appendOciArguments(arguments_)
  }

  const dryRun = await askBoolean("Dry run", false)
  if (dryRun) {
    arguments_.push("--dry-run")
  } else if (expert && await askBoolean("Keep workspace", false)) {
    arguments_.push("--keep")
  }
  await appendExtractorArguments(arguments_, language)
  return arguments_
}

const pullImageArguments = async (): Promise<Array<string>> => {
  const arguments_ = await pullArguments("pull-image")
  appendWhenPresent(arguments_, "--out", await askBlank("Output directory", "default repository"))
  if (await askBoolean("Replace an existing bundle", false)) arguments_.push("--force")
  if (await askBoolean("Adopt image for PharoLauncher", false)) {
    arguments_.push("--adopt")
    appendWhenPresent(arguments_, "--adopt-as", await askBlank("Adopted image name", "model name"))
    appendWhenPresent(arguments_, "--adopt-to", await askBlank("Adoption directory", "~/Documents/Pharo/images"))
  }
  return arguments_
}

const pullModelArguments = async (): Promise<Array<string>> => {
  const arguments_ = await pullArguments("pull-model")
  if (await askBoolean("Fetch even when installed locally", false)) arguments_.push("--force")
  return arguments_
}

const adoptImageArguments = async (): Promise<Array<string>> => {
  const coordinates = await askProjectCoordinates()
  const arguments_ = ["adopt-image", projectCoordinateArgument(coordinates)]
  appendWhenPresent(arguments_, "--adopt-as", await askBlank("Adopted image name", await defaultAdoptedImageName(coordinates)))
  appendWhenPresent(arguments_, "--adopt-to", await askBlank("Adoption directory", "~/Documents/Pharo/images"))
  return arguments_
}

const pullArguments = async (command: "pull-image" | "pull-model" | "adopt-image"): Promise<Array<string>> => {
  const arguments_: Array<string> = [command]
  if (command !== "adopt-image") {
    arguments_.push("--registry", await askRequired("OCI registry"))
    arguments_.push("--namespace", await askRequired("OCI namespace"))
  }
  arguments_.push(projectCoordinateArgument(await askProjectCoordinates()))
  return arguments_
}

const askProjectCoordinates = async (): Promise<ProjectCoordinates> => ({
  group: await askRequired("Project group"),
  name: await askRequired("Project name"),
  version: await askRequired("Project version")
})

const projectCoordinateArgument = (coordinates: ProjectCoordinates): string =>
  [coordinates.group, coordinates.name, coordinates.version].join(":")

const appendBuildOutputArguments = async (arguments_: Array<string>): Promise<void> =>
  appendWhenPresent(arguments_, "--out", await askBlank("Output directory", "default repository"))

const appendBuildImageAdoption = async (arguments_: Array<string>): Promise<void> => {
  if (!await askBoolean("Adopt image for PharoLauncher", false)) return

  arguments_.push("--adopt")
  appendWhenPresent(arguments_, "--adopt-as", await askBlank("Adopted image name", "model name"))
  appendWhenPresent(arguments_, "--adopt-to", await askBlank("Adoption directory", "~/Documents/Pharo/images"))
}

const appendExtractorArguments = async (arguments_: Array<string>, language: string | undefined): Promise<void> => {
  const extractorArguments = await runExtractorWizard(language)
  if (extractorArguments.length > 0) arguments_.push("--", ...extractorArguments)
}

const appendRuntimeArguments = async (arguments_: Array<string>, expert: boolean): Promise<void> => {
  const pharo = await askWithDefault("Pharo version", "latest")
  appendWhenChanged(arguments_, "--pharo", pharo, "latest")
  if (expert) appendWhenPresent(arguments_, "--vm-url", await askOverride("Pharo VM URL", pharoVmUrl(pharo)))

  const moose = await askWithDefault("Moose version", "latest")
  appendWhenChanged(arguments_, "--moose", moose, "latest")
  if (expert) {
    appendWhenPresent(arguments_, "--image-url", await askOverride("Moose image URL", mooseImageUrl(moose, pharo)))
    appendWhenChanged(arguments_, "--repository", await askWithDefault("MooseNexus repository", defaultRepository), defaultRepository)
    appendWhenChanged(arguments_, "--nexus-version", await askWithDefault("MooseNexus version", "1.x.x"), "1.x.x")
  }
}

const appendOciArguments = async (arguments_: Array<string>): Promise<void> => {
  const registry = await askBlank("OCI registry", "local only")
  if (registry === undefined) return
  arguments_.push("--registry", registry, "--namespace", await askRequired("OCI namespace"))
}

const askChoice = async (
  label: string,
  choices: ReadonlyArray<string>
): Promise<string> =>
  runPrompt(Prompt.select({
    message: label,
    choices: choices.map((value) => ({ title: value, value }))
  }))

const runPrompt = async <A>(prompt: Prompt.Prompt<A>): Promise<A> => {
  const exit = await Effect.runPromiseExit(prompt.pipe(Effect.provide(NodeContext.layer)))
  if (Exit.isSuccess(exit)) return exit.value

  const error = Option.getOrUndefined(Cause.failureOption(exit.cause))
  throw error ?? Cause.squash(exit.cause)
}

const askRequired = async (label: string): Promise<string> =>
  runPrompt(Prompt.text({
    message: label,
    validate: (value) => value.trim() === ""
      ? Effect.fail(`${label} is required.`)
      : Effect.succeed(value.trim())
  }))

const askOverride = async (label: string, defaultValue: string): Promise<string | undefined> => {
  const value = await runPrompt(Prompt.text({ message: `${label} [${defaultValue}]` }))
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

const askBlank = async (label: string, blankValue: string): Promise<string | undefined> => {
  const value = await runPrompt(Prompt.text({ message: `${label} [${blankValue}]` }))
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

const askWithDefault = async (label: string, defaultValue: string): Promise<string> =>
  (await runPrompt(Prompt.text({ message: label, default: defaultValue }))).trim() || defaultValue

const askBoolean = async (label: string, defaultValue: boolean): Promise<boolean> =>
  runPrompt(Prompt.select({
    message: label,
    choices: defaultValue
      ? [{ title: "yes", value: true }, { title: "no", value: false }]
      : [{ title: "no", value: false }, { title: "yes", value: true }]
  }))

const appendWhenChanged = (arguments_: Array<string>, name: string, value: string, defaultValue: string): void => {
  if (value !== defaultValue) arguments_.push(name, value)
}

const appendWhenPresent = (arguments_: Array<string>, name: string, value: string | undefined): void => {
  if (value !== undefined) arguments_.push(name, value)
}

const shellQuote = (value: string): string => /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\\"'\\\"'")}'`

const defaultRepository = "github://moosetechnology/MooseNexus"

const pharoVmUrl = (version: string): string => `https://get.pharo.org/64/vm${majorVersion(version)}0`

const mooseImageUrl = (mooseVersion: string, pharoVersion: string): string =>
  `https://github.com/moosetechnology/Moose/releases/download/v${mooseVersion}/Moose${majorVersion(mooseVersion)}-stable-Pharo64-${majorVersion(pharoVersion)}.zip`

const majorVersion = (version: string): string => version.split(".")[0] ?? version
