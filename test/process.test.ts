import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { runCommand } from "../src/process.js"

test("reports a failed command with its exit code and captured output", async () => {
  await assert.rejects(
    () => Effect.runPromise(runCommand(process.execPath, ["-e", "console.error('diagnostic output'); process.exit(7)"])),
    (error: unknown) => error instanceof Error
      && error.message.includes("exit code 7")
      && error.message.includes("diagnostic output")
  )
})
