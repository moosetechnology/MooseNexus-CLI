import assert from "node:assert/strict"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { join } from "node:path"

test("reports conflicting coordinate forms without an Effect stack trace", () => {
  const result = spawnSync(
    join(process.cwd(), "node_modules", ".bin", "tsx"),
    ["src/index.ts", "adopt-image", "com.example:backend:1.2.3", "--project-group", "com.example"],
    { encoding: "utf8" }
  )

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Error: Use either <group>:<name>:<version>/)
  assert.doesNotMatch(result.stderr, /at resolveProjectCoordinates/)
})
