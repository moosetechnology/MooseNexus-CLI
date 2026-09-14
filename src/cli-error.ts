import * as ValidationError from "@effect/cli/ValidationError"
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"
import { CommandFailure } from "./process.js"

export const cliErrorMessage = (error: unknown): string | undefined => {
  if (ValidationError.isValidationError(error)) return undefined

  if (error instanceof CommandFailure) return commandFailureMessage(error)

  return error instanceof Error ? error.message : String(error)
}

const commandFailureMessage = (error: CommandFailure): string => {
  const description = error.output
    .replaceAll(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("Error: ") || /^[A-Za-z][A-Za-z0-9_.-]*:\s+/.test(line))

  if (description !== undefined) {
    return description.startsWith("Error: ")
      ? description.slice("Error: ".length)
      : description
  }

  return error.exitCode === null
    ? `Could not start ${error.command}.`
    : `${error.command} failed with exit code ${error.exitCode}.`
}

export const formatCliError = (message: string, interactive: boolean): string => {
  const label = interactive
    ? Doc.annotate(Doc.text("Error:"), Ansi.red).pipe(Doc.render({ style: "pretty" }))
    : "Error:"
  return `${label} ${message}`
}

export const formatCliDiagnostic = (values: ReadonlyArray<unknown>, interactive: boolean): string => {
  const message = values.map(String).join(" ")
  return /^\x1b\[[0-9;]*m?Error:/.test(message) || message.startsWith("Error:")
    ? message
    : formatCliError(message, interactive)
}
