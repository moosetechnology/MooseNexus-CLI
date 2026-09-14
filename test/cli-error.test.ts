import * as ValidationError from "@effect/cli/ValidationError"
import assert from "node:assert/strict"
import test from "node:test"
import { cliErrorMessage, formatCliDiagnostic, formatCliError } from "../src/cli-error.js"
import { CommandFailure } from "../src/process.js"

test("does not render Effect CLI validation internals after its diagnostic", () => {
  const validationError = {
    [ValidationError.ValidationErrorTypeId]: ValidationError.ValidationErrorTypeId,
    _tag: "CommandMismatch"
  }

  assert.equal(cliErrorMessage(validationError), undefined)
  assert.equal(cliErrorMessage(new Error("Build failed")), "Build failed")
})

test("reduces command failures to a useful diagnostic", () => {
  const error = new CommandFailure("oras", ["push", "registry.example.com/private"], 1, "Error: authentication required\nStack frame")

  assert.equal(cliErrorMessage(error), "authentication required")
})

test("does not expose command arguments when a command has no diagnostic output", () => {
  const error = new CommandFailure("oras", ["push", "registry.example.com/private"], 1, "")

  assert.equal(cliErrorMessage(error), "oras failed with exit code 1.")
})

test("formats operational errors without ANSI escapes outside a terminal", () => {
  assert.equal(formatCliError("Build failed", false), "Error: Build failed")
  assert.match(formatCliError("Build failed", true), /\x1b\[.*Error:/)
})

test("formats parser diagnostics with the same error label", () => {
  assert.equal(formatCliDiagnostic(["Received unknown argument: '-project-name'"], false), "Error: Received unknown argument: '-project-name'")
  assert.equal(formatCliDiagnostic(["Error: Build failed"], false), "Error: Build failed")
})
