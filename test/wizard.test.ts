import * as Terminal from "@effect/platform/Terminal"
import assert from "node:assert/strict"
import test from "node:test"
import { isWizardCancellation, isWizardRequest } from "../src/wizard.js"

test("recognizes the short wizard flag", () => {
  assert.equal(isWizardRequest(["-w"]), true)
})

test("recognizes Effect prompt interruption as normal wizard cancellation", () => {
  assert.equal(isWizardCancellation(new Terminal.QuitException()), true)
  assert.equal(isWizardCancellation(new Error("unexpected failure")), false)
})
