import assert from "node:assert/strict"
import test from "node:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseVerveineJOptions } from "../src/verveinej.js"

test("parses native VerveineJ options after the separator", () => {
  const configuration = parseVerveineJOptions([
    "--runner", "local",
    "--directory", "~/tools/VerveineJ",
    "-format", "mse",
    "-alllocals",
    "-anchor", "entity",
    "-excludepath", "**/generated/**",
    "-17",
    "--jvm-args", "-Xmx4g",
    "-summary"
  ], undefined)

  assert.deepEqual(configuration, {
    runner: "local",
    directory: join(homedir(), "tools/VerveineJ"),
    format: "mse",
    allLocals: true,
    anchor: "entity",
    excludePaths: ["**/generated/**"],
    javaVersion: "17",
    jvmArgs: "-Xmx4g",
    summary: true
  })
})

test("rejects an unknown VerveineJ option", () => {
  assert.throws(
    () => parseVerveineJOptions(["--unknown"], undefined),
    /Unknown VerveineJ option after --: --unknown/
  )
})
