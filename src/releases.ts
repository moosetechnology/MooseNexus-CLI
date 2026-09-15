import { Effect } from "effect"
import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import type { CliConfig } from "./config.js"
import { runtimeDirectory } from "./runtime.js"
import { normalizeMooseVersion } from "./versions.js"

const execFileAsync = promisify(execFile)
const latestReleaseCacheTtlMilliseconds = 24 * 60 * 60 * 1000

interface LatestReleaseCacheEntry {
  readonly repository: string
  readonly tag: string
  readonly resolvedAt: string
}

interface FloatingTagCacheEntry {
  readonly repository: string
  readonly revision: string
  readonly tag: string
  readonly resolvedAt: string
}

interface MooseRelease {
  readonly tag_name: string
  readonly assets: ReadonlyArray<{
    readonly name: string
    readonly browser_download_url: string
  }>
}

export const resolveMooseNexusRelease = (
  config: CliConfig,
  options: { readonly refresh?: boolean } = {}
): Effect.Effect<CliConfig, Error> => {
  const repository = githubRepository(config.moosenexus.repository)
  const floatingTag = floatingTagForVersion(config.moosenexus.version)
  if (floatingTag !== undefined) return resolveFloatingTag(config, repository, floatingTag, options)
  if (config.moosenexus.version !== "latest") return Effect.succeed(withReleaseRevision(config, config.moosenexus.version))
  if (repository === undefined) return Effect.fail(new Error("--nexus-version latest requires a github://owner/repository MooseNexus repository."))

  return Effect.tryPromise({
    try: async () => {
      const cachedTag = options.refresh ? undefined : await cachedLatestReleaseTag(repository)
      if (cachedTag !== undefined) return withReleaseTag(config, cachedTag)

      const tag = await resolveLatestReleaseTag(repository)
      await writeLatestReleaseTag(repository, tag)
      return withReleaseTag(config, tag)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })
}

const resolveFloatingTag = (
  config: CliConfig,
  repository: string | undefined,
  tag: string,
  options: { readonly refresh?: boolean }
): Effect.Effect<CliConfig, Error> => {
  if (repository === undefined) {
    return Effect.fail(new Error(`--nexus-version ${tag} requires a github://owner/repository MooseNexus repository.`))
  }

  return Effect.tryPromise({
    try: async () => {
      const cached = options.refresh ? undefined : await cachedFloatingTag(repository, tag)
      const revision = cached ?? await resolveGitReferenceRevision(repository, tag)
      if (cached === undefined) await writeFloatingTag(repository, tag, revision)
      return withFloatingTag(config, tag, revision)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })
}

export const resolveMooseRuntimeRelease = (
  config: CliConfig,
  options: { readonly refresh?: boolean } = {}
): Effect.Effect<CliConfig, Error> => {
  const normalizedConfig: CliConfig = {
    ...config,
    moose: {
      ...config.moose,
      version: normalizeMooseVersion(config.moose.version)
    }
  }
  if (normalizedConfig.moose.version !== "latest" && normalizedConfig.pharo.version !== "latest") return Effect.succeed(normalizedConfig)

  const releasePath = normalizedConfig.moose.version === "latest"
    ? "latest"
    : `tags/v${normalizedConfig.moose.version}`

  return Effect.tryPromise({
    try: async () => {
      const cachedRelease = options.refresh ? undefined : await cachedMooseRelease(releasePath)
      const release = cachedRelease ?? await fetchMooseRelease(releasePath)
      if (cachedRelease === undefined) await writeMooseRelease(releasePath, release)
      return withMooseRuntimeRelease(normalizedConfig, release)
    },
    catch: (error) => error instanceof Error ? error : new Error(String(error))
  })
}

export const withMooseRuntimeRelease = (config: CliConfig, release: MooseRelease): CliConfig => {
  const mooseVersion = config.moose.version === "latest" ? versionFromTag(release.tag_name) : config.moose.version
  const images = release.assets.flatMap((asset) => {
    const match = /^Moose\d+-stable-Pharo64-(\d+)\.zip$/.exec(asset.name)
    return match === null ? [] : [{ pharoVersion: match[1]!, url: asset.browser_download_url }]
  })
  const image = config.pharo.version === "latest"
    ? images.sort((left, right) => Number(right.pharoVersion) - Number(left.pharoVersion))[0]
    : images.find((candidate) => candidate.pharoVersion === config.pharo.version)

  if (image === undefined) {
    throw new Error(`Moose ${mooseVersion} does not provide an image compatible with Pharo ${config.pharo.version === "latest" ? "latest" : config.pharo.version}.`)
  }

  return {
    ...config,
    pharo: {
      ...config.pharo,
      version: image.pharoVersion
    },
    moose: {
      ...config.moose,
      version: mooseVersion,
      imageUrl: config.moose.imageUrl ?? image.url
    }
  }
}

const resolveLatestReleaseTag = async (repository: string): Promise<string> => {
  if (process.env.GITHUB_TOKEN === undefined || process.env.GITHUB_TOKEN === "") {
    const tag = await latestReleaseTagUsingGh(repository)
    if (tag !== undefined) return tag
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: githubHeaders()
  })
  if (!response.ok) {
    throw latestReleaseError(response)
  }
  const release: unknown = await response.json()
  if (typeof release !== "object" || release === null || !("tag_name" in release) || typeof release.tag_name !== "string") {
    throw new Error("GitHub's latest MooseNexus release response did not contain a tag name.")
  }
  return release.tag_name
}

export const latestReleaseCacheFile = (repository: string): string =>
  join(
    runtimeDirectory(),
    "releases",
    repository === "moosetechnology/MooseNexus"
      ? "nexus-latest.json"
      : `nexus-${repository.replaceAll("/", "-")}-latest.json`
  )

export const floatingTagCacheFile = (repository: string, tag: string): string =>
  join(
    runtimeDirectory(),
    "releases",
    repository === "moosetechnology/MooseNexus"
      ? `nexus-${tag}.json`
      : `nexus-${repository.replaceAll("/", "-")}-${tag}.json`
  )

export const isLatestReleaseCacheFresh = (entry: Pick<LatestReleaseCacheEntry, "resolvedAt">, now = Date.now()): boolean =>
  now - Date.parse(entry.resolvedAt) < latestReleaseCacheTtlMilliseconds

const cachedLatestReleaseTag = async (repository: string): Promise<string | undefined> => {
  try {
    const entry = JSON.parse(await readFile(latestReleaseCacheFile(repository), "utf8")) as LatestReleaseCacheEntry
    return entry.repository === repository && isLatestReleaseCacheFresh(entry) ? entry.tag : undefined
  } catch {
    return undefined
  }
}

const writeLatestReleaseTag = async (repository: string, tag: string): Promise<void> => {
  const cacheFile = latestReleaseCacheFile(repository)
  await mkdir(join(runtimeDirectory(), "releases"), { recursive: true })
  await writeFile(cacheFile, JSON.stringify({ repository, tag, resolvedAt: new Date().toISOString() }) + "\n")
}

const cachedFloatingTag = async (repository: string, tag: string): Promise<string | undefined> => {
  try {
    const entry = JSON.parse(await readFile(floatingTagCacheFile(repository, tag), "utf8")) as FloatingTagCacheEntry
    return entry.repository === repository && entry.tag === tag && isLatestReleaseCacheFresh(entry) ? entry.revision : undefined
  } catch {
    return undefined
  }
}

const writeFloatingTag = async (repository: string, tag: string, revision: string): Promise<void> => {
  await mkdir(join(runtimeDirectory(), "releases"), { recursive: true })
  await writeFile(
    floatingTagCacheFile(repository, tag),
    JSON.stringify({ repository, tag, revision, resolvedAt: new Date().toISOString() }) + "\n"
  )
}

const mooseReleaseCacheFile = (releasePath: string): string =>
  join(runtimeDirectory(), "releases", `moose-${releasePath.replaceAll("/", "-")}.json`)

const cachedMooseRelease = async (releasePath: string): Promise<MooseRelease | undefined> => {
  try {
    const entry = JSON.parse(await readFile(mooseReleaseCacheFile(releasePath), "utf8")) as {
      readonly release: MooseRelease
      readonly resolvedAt: string
    }
    return isLatestReleaseCacheFresh(entry) ? entry.release : undefined
  } catch {
    return undefined
  }
}

const writeMooseRelease = async (releasePath: string, release: MooseRelease): Promise<void> => {
  const cacheFile = mooseReleaseCacheFile(releasePath)
  await mkdir(join(runtimeDirectory(), "releases"), { recursive: true })
  await writeFile(cacheFile, JSON.stringify({ release, resolvedAt: new Date().toISOString() }) + "\n")
}

const fetchMooseRelease = async (releasePath: string): Promise<MooseRelease> => {
  const release = process.env.GITHUB_TOKEN === undefined || process.env.GITHUB_TOKEN === ""
    ? await mooseReleaseUsingGh(releasePath)
    : undefined
  if (release !== undefined) return release

  const response = await fetch(`https://api.github.com/repos/moosetechnology/Moose/releases/${releasePath}`, {
    headers: githubHeaders()
  })
  if (!response.ok) throw latestReleaseError(response)
  return parseMooseRelease(await response.json())
}

const mooseReleaseUsingGh = async (releasePath: string): Promise<MooseRelease | undefined> => {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      "--hostname", "github.com",
      `repos/moosetechnology/Moose/releases/${releasePath}`
    ])
    return parseMooseRelease(JSON.parse(stdout))
  } catch {
    return undefined
  }
}

const parseMooseRelease = (value: unknown): MooseRelease => {
  if (typeof value !== "object" || value === null || !("tag_name" in value) || !("assets" in value)) {
    throw new Error("Moose release metadata is incomplete.")
  }
  const tag = value.tag_name
  const assets = value.assets
  if (typeof tag !== "string" || !Array.isArray(assets)) throw new Error("Moose release metadata is incomplete.")

  const parsedAssets = assets.map((asset) => {
    if (typeof asset !== "object" || asset === null || !("name" in asset) || !("browser_download_url" in asset)) {
      throw new Error("Moose release metadata contains an invalid asset.")
    }
    if (typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") {
      throw new Error("Moose release metadata contains an invalid asset.")
    }
    return { name: asset.name, browser_download_url: asset.browser_download_url }
  })
  return { tag_name: tag, assets: parsedAssets }
}

const versionFromTag = (tag: string): string => tag.startsWith("v") ? tag.slice(1) : tag

export const latestReleaseError = (response: Pick<Response, "status" | "headers">): Error => {
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    return new Error("GitHub API rate limit is exhausted while resolving the latest MooseNexus release. Set GITHUB_TOKEN, authenticate gh, or pass --nexus-version <release>.")
  }
  return new Error(`Could not resolve the latest MooseNexus release from GitHub (HTTP ${response.status}).`)
}

const latestReleaseTagUsingGh = async (repository: string): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      "--hostname", "github.com",
      `repos/${repository}/releases/latest`,
      "--jq", ".tag_name"
    ])
    const tag = stdout.trim()
    return tag === "" ? undefined : tag
  } catch {
    return undefined
  }
}

const resolveGitReferenceRevision = async (repository: string, tag: string): Promise<string> => {
  const reference = await githubApiValue(repository, `git/ref/tags/${tag}`)
  return resolveGitObjectRevision(repository, reference)
}

const resolveGitObjectRevision = async (repository: string, value: unknown): Promise<string> => {
  if (typeof value !== "object" || value === null || !("object" in value) || typeof value.object !== "object" || value.object === null) {
    throw new Error("MooseNexus floating tag metadata is incomplete.")
  }

  const object = value.object
  if (!("sha" in object) || !("type" in object) || typeof object.sha !== "string" || typeof object.type !== "string") {
    throw new Error("MooseNexus floating tag metadata is incomplete.")
  }
  if (object.type === "commit") return object.sha
  if (object.type !== "tag") throw new Error(`MooseNexus floating tag resolves to unsupported Git object type: ${object.type}.`)

  return resolveGitObjectRevision(repository, await githubApiValue(repository, `git/tags/${object.sha}`))
}

const githubApiValue = async (repository: string, path: string): Promise<unknown> => {
  if (process.env.GITHUB_TOKEN === undefined || process.env.GITHUB_TOKEN === "") {
    const value = await githubApiValueUsingGh(repository, path)
    if (value !== undefined) return value
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: githubHeaders() })
  if (!response.ok) throw new Error(`Could not resolve MooseNexus floating tag from GitHub (HTTP ${response.status}).`)
  return response.json()
}

const githubApiValueUsingGh = async (repository: string, path: string): Promise<unknown | undefined> => {
  try {
    const { stdout } = await execFileAsync("gh", ["api", "--hostname", "github.com", `repos/${repository}/${path}`])
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

const githubHeaders = (): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "MooseNexus-CLI",
    ...(token === undefined || token === "" ? {} : { Authorization: `Bearer ${token}` })
  }
}

export const withReleaseTag = (config: CliConfig, tag: string): CliConfig => ({
  ...config,
  moosenexus: {
    ...config.moosenexus,
    version: tag.startsWith("v") ? tag.slice(1) : tag,
    revision: tag,
    resolvedRevision: undefined
  }
})

export const withFloatingTag = (config: CliConfig, tag: string, revision: string): CliConfig => ({
  ...config,
  moosenexus: {
    ...config.moosenexus,
    version: versionFromTag(tag),
    revision,
    resolvedRevision: revision
  }
})

const withReleaseRevision = (config: CliConfig, version: string): CliConfig => ({
  ...config,
  moosenexus: {
    ...config.moosenexus,
    version: version.startsWith("v") ? version.slice(1) : version,
    revision: config.moosenexus.revision ?? (version.startsWith("v") ? version : `v${version}`),
    resolvedRevision: undefined
  }
})

const floatingTagForVersion = (version: string): string | undefined =>
  /^(?:v?\d+\.x\.x|v?\d+\.\d+\.x)$/.test(version)
    ? version.startsWith("v") ? version : `v${version}`
    : undefined

const githubRepository = (repository: string): string | undefined => {
  const match = /^github:\/\/([^/:]+\/[^/:]+)$/.exec(repository)
  return match?.[1]
}
