import assert from "node:assert/strict"
import test from "node:test"
import { inspectEnvironment, renderDoctorReport } from "../src/doctor.js"

test("reports available and unavailable workflow capabilities", async () => {
  const report = await inspectEnvironment(
    async (command) => {
      if (command === "oras") return "----------------\nVersion: 1.2.3\n"
      throw new Error(`${command} is unavailable`)
    },
    "v24.0.0"
  )

  assert.equal(report.nodeVersion, "v24.0.0")
  assert.deepEqual(report.checks.find((check) => check.capability === "ORAS"), {
    capability: "ORAS",
    status: "available",
    detail: "Version: 1.2.3"
  })
  assert.deepEqual(report.checks.find((check) => check.capability === "Docker"), {
    capability: "Docker",
    status: "unavailable",
    detail: "unavailable; required by Docker-backed extractors"
  })
})

test("renders a readable environment report", () => {
  const report = {
    nodeVersion: "v24.0.0",
    checks: [{ capability: "ORAS", status: "available" as const, detail: "Version: 1.2.3" }]
  }

  assert.equal(
    renderDoctorReport(report),
    "MooseNexus environment\nNode.js v24.0.0\n\n✓ ORAS: Version: 1.2.3"
  )
})
