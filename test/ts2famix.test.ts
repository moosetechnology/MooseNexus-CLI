import assert from "node:assert/strict"
import test from "node:test"
import { parseTs2FamixOptions } from "../src/ts2famix.js"

test("parses pinned ts2famix source options after the separator", () => {
  assert.deepEqual(
    parseTs2FamixOptions([
      "--repository", "https://example.com/ts2famix.git",
      "--revision", "0123456789abcdef"
    ], undefined),
    {
      repository: "https://example.com/ts2famix.git",
      revision: "0123456789abcdef"
    }
  )
})

test("rejects unknown ts2famix options", () => {
  assert.throws(
    () => parseTs2FamixOptions(["--unknown"], undefined),
    /Unknown ts2famix option after --: --unknown/
  )
})
