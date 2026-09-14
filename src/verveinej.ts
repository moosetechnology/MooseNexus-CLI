import * as Prompt from "@effect/cli/Prompt"
import * as Terminal from "@effect/platform/Terminal"
import * as NodeContext from "@effect/platform-node/NodeContext"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { homedir } from "node:os"
import { join } from "node:path"
import type { CliConfig } from "./config.js"

type VerveineJConfiguration = NonNullable<CliConfig["buildSpec"]["verveineJ"]>
type VerveineJOptionPatch = { -readonly [Key in keyof VerveineJConfiguration]?: VerveineJConfiguration[Key] }

export const parseVerveineJOptions = (
  arguments_: ReadonlyArray<string>,
  configured: VerveineJConfiguration | undefined
): VerveineJConfiguration => {
  const patch: VerveineJOptionPatch = {}

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === undefined) break
    switch (argument) {
      case "--runner":
        patch.runner = runnerValue(nextValue(arguments_, ++index, argument))
        break
      case "--directory":
        patch.directory = expandHomeDirectory(nextValue(arguments_, ++index, argument))
        break
      case "--version":
        patch.version = nextValue(arguments_, ++index, argument)
        break
      case "--jvm-args":
        patch.jvmArgs = nextValue(arguments_, ++index, argument)
        break
      case "-format":
        patch.format = formatValue(nextValue(arguments_, ++index, argument))
        break
      case "-alllocals":
        patch.allLocals = true
        break
      case "-anchor":
        patch.anchor = anchorValue(nextValue(arguments_, ++index, argument))
        break
      case "-excludepath":
        patch.excludePaths = [...(patch.excludePaths ?? []), nextValue(arguments_, ++index, argument)]
        break
      case "-summary":
        patch.summary = true
        break
      default:
        if (/^-\d+(?:\.\d+)*$/.test(argument)) {
          patch.javaVersion = argument.slice(1)
          break
        }
        throw new Error(`Unknown VerveineJ option after --: ${argument}.`)
    }
  }

  return {
    ...configured,
    ...patch,
    runner: patch.runner ?? configured?.runner ?? "docker"
  }
}

export const runVerveineJWizard = async (): Promise<ReadonlyArray<string>> => {
  const arguments_: Array<string> = []
  const runner = await askChoice("VerveineJ runner", ["docker", "local"])
  if (runner === "local") {
    arguments_.push("--runner", "local", "--directory", await askRequired("VerveineJ directory"))
  } else {
    appendWhenChanged(arguments_, "--version", await askWithDefault("VerveineJ version", "latest"), "latest")
  }

  const format = await askChoice("VerveineJ format", ["json", "mse"])
  appendWhenChanged(arguments_, "-format", format, "json")
  if (await askBoolean("Include local variables", false)) arguments_.push("-alllocals")

  const anchor = await askChoice("Source anchors", ["default", "none", "entity", "assoc"])
  if (anchor !== "default") arguments_.push("-anchor", anchor)

  while (true) {
    const path = await askBlank("Excluded source path", "none")
    if (path === undefined) break
    arguments_.push("-excludepath", path)
  }

  const javaVersion = await askBlank("Java source level", "VerveineJ default")
  if (javaVersion !== undefined) arguments_.push(`-${javaVersion}`)
  const jvmArgs = await askBlank("JVM arguments", "none")
  if (jvmArgs !== undefined) arguments_.push("--jvm-args", jvmArgs)
  if (await askBoolean("Enable summary output", false)) arguments_.push("-summary")
  return arguments_
}

const nextValue = (arguments_: ReadonlyArray<string>, index: number, option: string): string => {
  const value = arguments_[index]
  if (value === undefined) throw new Error(`${option} requires a value.`)
  return value
}

const runnerValue = (value: string): VerveineJConfiguration["runner"] => {
  if (value === "docker" || value === "local") return value
  throw new Error(`Invalid VerveineJ runner: ${value}. Expected docker or local.`)
}

const formatValue = (value: string): NonNullable<VerveineJConfiguration["format"]> => {
  if (value === "json" || value === "mse") return value
  throw new Error(`Invalid VerveineJ format: ${value}. Expected json or mse.`)
}

const anchorValue = (value: string): NonNullable<VerveineJConfiguration["anchor"]> => {
  if (["none", "entity", "default", "assoc"].includes(value)) {
    return value as NonNullable<VerveineJConfiguration["anchor"]>
  }
  throw new Error(`Invalid VerveineJ anchor: ${value}. Expected none, entity, default, or assoc.`)
}

const expandHomeDirectory = (path: string): string => {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

const askChoice = async (label: string, choices: ReadonlyArray<string>): Promise<string> =>
  runPrompt(Prompt.select({
    message: label,
    choices: choices.map((value) => ({ title: value, value }))
  }))

const askRequired = async (label: string): Promise<string> =>
  runPrompt(Prompt.text({
    message: label,
    validate: (value) => value.trim() === ""
      ? Effect.fail(`${label} is required.`)
      : Effect.succeed(value.trim())
  }))

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

const runPrompt = async <A>(prompt: Prompt.Prompt<A>): Promise<A> => {
  const exit = await Effect.runPromiseExit(prompt.pipe(Effect.provide(NodeContext.layer)))
  if (Exit.isSuccess(exit)) return exit.value

  const error = Option.getOrUndefined(Cause.failureOption(exit.cause))
  throw error ?? Cause.squash(exit.cause)
}

const appendWhenChanged = (arguments_: Array<string>, name: string, value: string, defaultValue: string): void => {
  if (value !== defaultValue) arguments_.push(name, value)
}

export const isExtractorWizardCancellation = (error: unknown): boolean =>
  Terminal.isQuitException(error) || (error instanceof Error && error.name === "AbortError")
