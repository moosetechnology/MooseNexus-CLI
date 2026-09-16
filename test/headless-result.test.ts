import assert from "node:assert/strict"
import test from "node:test"
import { headlessFailureMessage, parseHeadlessResult, supportsHeadlessOperationResults } from "../src/headless-result.js"

const successResult = {
  schemaVersion: "1",
  operation: "build-image",
  phase: "execute-spec",
  status: "success",
  code: "ok",
  message: null,
  context: { project: "com.example:demo:1.0.0" }
} as const

test("parses the versioned MooseNexus headless result envelope", () => {
  assert.deepEqual(parseHeadlessResult(successResult), successResult)
})

test("formats a structured MooseNexus failure without a Pharo stack trace", () => {
  const result = parseHeadlessResult({
    ...successResult,
    status: "failure",
    code: "operation-failed",
    message: "Maven artifact materialization failed"
  })

  assert.equal(headlessFailureMessage(result), "Maven artifact materialization failed (operation-failed)")
})

test("rejects a result with an unknown schema version", () => {
  assert.throws(
    () => parseHeadlessResult({ ...successResult, schemaVersion: "2" }),
    /unsupported result schema version/
  )
})

test("recognizes the MooseNexus releases that provide headless results", () => {
  assert.equal(supportsHeadlessOperationResults("1.0.1"), false)
  assert.equal(supportsHeadlessOperationResults("1.1.0"), true)
  assert.equal(supportsHeadlessOperationResults("1.1.x"), true)
  assert.equal(supportsHeadlessOperationResults("1.x.x"), false)
  assert.equal(supportsHeadlessOperationResults("2.0.0"), true)
})
