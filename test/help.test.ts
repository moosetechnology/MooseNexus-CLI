import assert from "node:assert/strict"
import test from "node:test"
import { helpForArguments } from "../src/help.js"

test("renders compact root help without a trailing blank block", () => {
  const help = helpForArguments([])

  assert.ok(help !== undefined)
  assert.match(help, /MooseNexus CLI 1\.1\.0/)
  assert.match(help, /build-image  Build, install, and optionally export or publish/)
  assert.match(help, /adopt-image  Copy an installed image artifact into a mutable Pharo image folder/)
  assert.match(help, /publish-image Publish an installed Moose image artifact without rebuilding it/)
  assert.match(help, /publish-model Publish an installed Moose model artifact without rebuilding it/)
  assert.match(help, /doctor       Check local tools used by MooseNexus workflows/)
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
  assert.match(pullHelp, /Usage: moosenexus pull-image <coordinates>/)
  assert.match(pullHelp, /--adopt-as <name>/)
  assert.match(pullHelp, /--adopt-to <path>/)
  assert.match(adoptHelp, /Usage: moosenexus adopt-image <coordinates>/)
  assert.match(adoptHelp, /Copy an installed image artifact into a mutable Pharo image folder/)
})

test("groups build options without Effect's primitive type explanations", () => {
  const help = helpForArguments(["build-image", "--help"])

  assert.ok(help !== undefined)
  assert.match(help, /Input: provide --spec/)
  assert.match(help, /\[coordinates\]/)
  assert.match(help, /\[source\]/)
  assert.match(help, /<group>:<name>:<version>/)
  assert.match(help, /Extractor Options:/)
  assert.match(help, /Append -- followed by options for the extractor selected by --language\./)
  assert.match(help, /Runtime:/)
  assert.match(help, /Artifact:/)
  assert.match(help, /Build a fresh Moose image containing a Moose model/)
  assert.match(help, /--pharo <version>                   Pharo version\. Default: latest compatible with Moose\./)
  assert.match(help, /--out <path>                        Retain the portable ZIP in this directory\./)
  assert.match(help, /-w, --wizard \[--expert\]             Interactively construct a valid command/)
  assert.equal(help.includes("Unmarked options are optional."), false)
  assert.equal(help.includes("Defaults:"), false)
  assert.equal(help.includes("A user-defined piece of text."), false)
  assert.equal(help.includes("This setting is optional."), false)
})

test("does not require OCI settings for a local model build", () => {
  const help = helpForArguments(["build-model", "--help"])

  assert.ok(help !== undefined)
  assert.match(help, /--registry <host>                   OCI registry host; provide with --namespace to publish\./)
  assert.doesNotMatch(help, /--registry <host>                   OCI registry host\. \[required\]/)
})

test("documents local artifact listing", () => {
  const help = helpForArguments(["artifacts", "--help"])

  assert.ok(help !== undefined)
  assert.match(help, /List model and image artifacts installed in the local MooseNexus repository/)
  assert.match(help, /--json/)
})

test("documents machine-readable results and environment checks", () => {
  const buildHelp = helpForArguments(["build-image", "--help"])
  const doctorHelp = helpForArguments(["doctor", "--help"])

  assert.ok(buildHelp !== undefined)
  assert.ok(doctorHelp !== undefined)
  assert.match(buildHelp, /--json                              Write one machine-readable result to standard output/)
  assert.match(doctorHelp, /Check local tools used by MooseNexus workflows/)
})

test("documents publication of installed artifacts", () => {
  const imageHelp = helpForArguments(["publish-image", "--help"])
  const modelHelp = helpForArguments(["publish-model", "--help"])

  assert.ok(imageHelp !== undefined)
  assert.ok(modelHelp !== undefined)
  assert.match(imageHelp, /Publish an image artifact already installed in the local MooseNexus repository/)
  assert.match(modelHelp, /Publish a model artifact already installed in the local MooseNexus repository/)
})
