import assert from "node:assert/strict"
import test from "node:test"
import { parseProjectCoordinates, resolveProjectCoordinates } from "../src/coordinates.js"

test("parses compact project coordinates", () => {
  assert.deepEqual(
    parseProjectCoordinates("com.example:backend:1.2.3"),
    { group: "com.example", name: "backend", version: "1.2.3" }
  )
})

test("rejects malformed compact project coordinates", () => {
  assert.throws(
    () => parseProjectCoordinates("com.example:backend"),
    /Expected <group>:<name>:<version>/
  )
})

test("uses compact coordinates in preference to configured coordinates", () => {
  assert.deepEqual(
    resolveProjectCoordinates(
      "com.example:backend:1.2.3",
      { group: undefined, name: undefined, version: undefined },
      { group: "com.old", name: "old", version: "1.0.0" }
    ),
    { group: "com.example", name: "backend", version: "1.2.3" }
  )
})

test("rejects compact coordinates combined with expanded flags", () => {
  assert.throws(
    () => resolveProjectCoordinates(
      "com.example:backend:1.2.3",
      { group: "com.example", name: undefined, version: undefined },
      undefined
    ),
    /Use either <group>:<name>:<version>/
  )
})
