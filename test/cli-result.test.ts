import assert from "node:assert/strict"
import test from "node:test"
import { renderJsonPlan, renderJsonResult } from "../src/cli-result.js"

test("renders versioned JSON operation results", () => {
  const rendered = renderJsonResult("pull-model", { repositoryDirectory: "/tmp/repository" })

  assert.deepEqual(JSON.parse(rendered), {
    schemaVersion: "1",
    operation: "pull-model",
    status: "success",
    result: { repositoryDirectory: "/tmp/repository" }
  })
})

test("renders versioned JSON operation plans", () => {
  const rendered = renderJsonPlan("build-model", { steps: [] })

  assert.deepEqual(JSON.parse(rendered), {
    schemaVersion: "1",
    operation: "build-model",
    status: "planned",
    plan: { steps: [] }
  })
})
