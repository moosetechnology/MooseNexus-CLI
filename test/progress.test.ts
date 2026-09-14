import assert from "node:assert/strict"
import test from "node:test"
import { CliWorkflowProgress, spinnerEnabled, spinnerLabel } from "../src/progress.js"

test("reports stable workflow transitions outside an interactive terminal", () => {
  const lines: Array<string> = []
  const progress = new CliWorkflowProgress({ write: (line) => {
    lines.push(String(line))
    return true
  } }, false)
  const download = { name: "download", detail: "Download Moose" }
  const publish = { name: "publish", detail: "Skip OCI publication" }

  progress.start(download)
  progress.complete(download)
  progress.skip(publish)

  assert.deepEqual(lines, ["> Download Moose\n", "✓ Download Moose\n", "- Skip OCI publication\n"])
})

test("keeps animated labels within one terminal line", () => {
  assert.equal(spinnerLabel("Download and extract Moose 12.0.0 from https://example.com/archive.zip", 30), "Download and extract Mo...")
})

test("disables animation in automation contexts and when requested", () => {
  assert.equal(spinnerEnabled({}, true), true)
  assert.equal(spinnerEnabled({ CI: "true" }, true), false)
  assert.equal(spinnerEnabled({ TERM: "dumb" }, true), false)
  assert.equal(spinnerEnabled({ MOOSENEXUS_SPINNER_DISABLED: "1" }, true), false)
  assert.equal(spinnerEnabled({ MOOSENEXUS_SPINNER_DISABLED: "false" }, true), true)
  assert.equal(spinnerEnabled({}, false), false)
})
