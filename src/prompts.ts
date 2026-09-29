import * as Prompt from "@effect/cli/Prompt"
import * as Terminal from "@effect/platform/Terminal"
import * as NodeContext from "@effect/platform-node/NodeContext"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"

export const askChoice = async (label: string, choices: ReadonlyArray<string>): Promise<string> =>
  runPrompt(Prompt.select({
    message: label,
    choices: choices.map((value) => ({ title: value, value }))
  }))

export const askRequired = async (label: string): Promise<string> =>
  runPrompt(Prompt.text({
    message: label,
    validate: (value) => value.trim() === ""
      ? Effect.fail(`${label} is required.`)
      : Effect.succeed(value.trim())
  }))

export const askBlank = async (label: string, blankValue: string): Promise<string | undefined> => {
  const value = await runPrompt(Prompt.text({ message: `${label} [${blankValue}]` }))
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

export const askWithDefault = async (label: string, defaultValue: string): Promise<string> =>
  (await runPrompt(Prompt.text({ message: label, default: defaultValue }))).trim() || defaultValue

export const askBoolean = async (label: string, defaultValue: boolean): Promise<boolean> =>
  runPrompt(Prompt.select({
    message: label,
    choices: defaultValue
      ? [{ title: "yes", value: true }, { title: "no", value: false }]
      : [{ title: "no", value: false }, { title: "yes", value: true }]
  }))

export const isPromptCancellation = (error: unknown): boolean =>
  Terminal.isQuitException(error) || (error instanceof Error && error.name === "AbortError")

const runPrompt = async <A>(prompt: Prompt.Prompt<A>): Promise<A> => {
  const exit = await Effect.runPromiseExit(prompt.pipe(Effect.provide(NodeContext.layer)))
  if (Exit.isSuccess(exit)) return exit.value

  const error = Option.getOrUndefined(Cause.failureOption(exit.cause))
  throw error ?? Cause.squash(exit.cause)
}
