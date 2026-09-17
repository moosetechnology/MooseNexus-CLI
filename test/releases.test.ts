import assert from "node:assert/strict"
import test from "node:test"
import { defaultCliConfig } from "../src/config.js"
import { floatingTagCacheFile, isLatestReleaseCacheFresh, latestReleaseCacheFile, latestReleaseError, releaseVersionForRevision, withFloatingTag, withMooseRuntimeRelease, withReleaseTag } from "../src/releases.js"
import { metacelloRepository } from "../src/scripts.js"

test("uses the immutable GitHub tag resolved for latest", () => {
  const config = withReleaseTag(defaultCliConfig, "v0.1.0")

  assert.equal(config.moosenexus.version, "0.1.0")
  assert.equal(config.moosenexus.revision, "v0.1.0")
  assert.equal(metacelloRepository(config), "github://moosetechnology/MooseNexus:v0.1.0/src")
})

test("pins a floating v1 tag to its resolved commit", () => {
  const config = withFloatingTag(defaultCliConfig, "v1.x.x", "aad52f086c0eee83a7fd744e1036e47884e1a8e5", "1.1.3")

  assert.equal(config.moosenexus.version, "1.1.3")
  assert.equal(config.moosenexus.revision, "aad52f086c0eee83a7fd744e1036e47884e1a8e5")
  assert.equal(config.moosenexus.resolvedRevision, "aad52f086c0eee83a7fd744e1036e47884e1a8e5")
  assert.equal(metacelloRepository(config), "github://moosetechnology/MooseNexus:aad52f086c0eee83a7fd744e1036e47884e1a8e5/src")
})

test("finds the concrete release matching a floating tag revision", () => {
  const version = releaseVersionForRevision([
    { ref: "refs/tags/v1.x.x", object: { sha: "current" } },
    { ref: "refs/tags/v1.1.2", object: { sha: "previous" } },
    { ref: "refs/tags/v1.1.3", object: { sha: "current" } }
  ], "current")

  assert.equal(version, "1.1.3")
})

test("explains how to recover from GitHub API rate limiting", () => {
  const error = latestReleaseError(new Response(null, {
    status: 403,
    headers: { "x-ratelimit-remaining": "0" }
  }))

  assert.match(error.message, /Set GITHUB_TOKEN, authenticate gh, or pass --nexus-version <release>/)
})

test("keeps latest-release resolutions for no more than one day", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z")
  const recent = { repository: "moosetechnology/MooseNexus", tag: "v0.4.0", resolvedAt: "2026-09-07T12:00:01.000Z" }
  const expired = { ...recent, resolvedAt: "2026-09-07T12:00:00.000Z" }

  assert.equal(isLatestReleaseCacheFresh(recent, now), true)
  assert.equal(isLatestReleaseCacheFresh(expired, now), false)
})

test("uses role-based names for latest release caches", () => {
  assert.match(latestReleaseCacheFile("moosetechnology/MooseNexus"), /nexus-latest\.json$/)
  assert.match(latestReleaseCacheFile("example/MooseNexus"), /nexus-example-MooseNexus-latest\.json$/)
})

test("uses a distinct cache entry for each floating tag", () => {
  assert.match(floatingTagCacheFile("moosetechnology/MooseNexus", "v1.x.x"), /nexus-v1\.x\.x\.json$/)
  assert.match(floatingTagCacheFile("example/MooseNexus", "v1.0.x"), /nexus-example-MooseNexus-v1\.0\.x\.json$/)
})

test("selects the newest Pharo image supported by the latest Moose release", () => {
  const config = withMooseRuntimeRelease(defaultCliConfig, {
    tag_name: "v13.0.0",
    assets: [
      { name: "Moose13-stable-Pharo64-12.zip", browser_download_url: "https://example.com/moose13-pharo12.zip" },
      { name: "Moose13-stable-Pharo64-13.zip", browser_download_url: "https://example.com/moose13-pharo13.zip" }
    ]
  })

  assert.equal(config.moose.version, "13.0.0")
  assert.equal(config.moose.imageUrl, "https://example.com/moose13-pharo13.zip")
  assert.equal(config.pharo.version, "13")
})

test("keeps an explicitly requested compatible Pharo version", () => {
  const config = withMooseRuntimeRelease({
    ...defaultCliConfig,
    pharo: { version: "12" }
  }, {
    tag_name: "v13.0.0",
    assets: [
      { name: "Moose13-stable-Pharo64-12.zip", browser_download_url: "https://example.com/moose13-pharo12.zip" },
      { name: "Moose13-stable-Pharo64-13.zip", browser_download_url: "https://example.com/moose13-pharo13.zip" }
    ]
  })

  assert.equal(config.pharo.version, "12")
  assert.equal(config.moose.imageUrl, "https://example.com/moose13-pharo12.zip")
})
