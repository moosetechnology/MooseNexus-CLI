import assert from "node:assert/strict"
import test from "node:test"
import { helpForArguments } from "../src/help.js"

test("renders compact root help without a trailing blank block", () => {
  const help = helpForArguments([])

  assert.ok(help !== undefined)
  assert.match(help, /MooseNexus CLI 1\.0\.0/)
  assert.match(help, /build-image  Build, package, and optionally publish/)
  assert.match(help, /adopt-image  Copy an installed image artifact into a mutable Pharo image folder/)
  assert.match(help, /Run `moosenexus --wizard` to build a command interactively\./)
  assert.equal(help.endsWith("\n"), false)
  assert.equal(help.includes("A user-defined piece of text."), false)
  assert.equal(help.includes("This setting is optional."), false)
})

test("documents image adoption separately from OCI retrieval", () => {
  const pullHelp = helpForArguments(["pull-image", "--help"])
  const adoptHelp = helpForArguments(["adopt-image", "--help"])

  assert.ok(pullHelp !== undefined)
  assert.ok(adoptHelp !== undefined)
  assert.match(pullHelp, /--adopt-as <name>/)
  assert.match(pullHelp, /--adopt-to <path>/)
  assert.match(adoptHelp, /Copy an installed image artifact into a mutable Pharo image folder/)
})

test("groups build options without Effect's primitive type explanations", () => {
  const help = helpForArguments(["build-image", "--help"])

  assert.ok(help !== undefined)
  assert.match(help, /Input: provide --spec/)
  assert.match(help, /Extractor Options:/)
  assert.match(help, /Append -- followed by options for the extractor selected by --language\./)
  assert.match(help, /Runtime:/)
  assert.match(help, /Artifact:/)
  assert.match(help, /Build a fresh Moose image containing a Moose model/)
  assert.match(help, /--pharo <version>                   Pharo version\. Default: latest compatible with Moose\./)
  assert.match(help, /--out <path>                        Directory for the completed ZIP\. Default: \.\/artifacts\./)
  assert.match(help, /-w, --wizard \[--expert\]             Interactively construct a valid command/)
  assert.equal(help.includes("Unmarked options are optional."), false)
  assert.equal(help.includes("Defaults:"), false)
  assert.equal(help.includes("A user-defined piece of text."), false)
  assert.equal(help.includes("This setting is optional."), false)
})
