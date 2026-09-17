import { Effect } from "effect"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"

export interface Workspace {
  readonly directory: string
  readonly downloadsDirectory: string
  readonly vmDirectory: string
  readonly imageDirectory: string
  readonly toolsDirectory: string
  readonly scriptsDirectory: string
  readonly resultsDirectory: string
  readonly bundleDirectory: string
  readonly artifactsDirectory: string
}

export const withWorkspace = <A, E, R>(
  keep: boolean,
  use: (workspace: Workspace) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    createWorkspace,
    use,
    (workspace) => keep ? Effect.void : removeWorkspace(workspace)
  )

const createWorkspace: Effect.Effect<Workspace> = Effect.promise(async () => {
  const directory = join(tmpdir(), `moosenexus-cli-${randomUUID()}`)
  const workspace = {
    directory,
    downloadsDirectory: join(directory, "downloads"),
    vmDirectory: join(directory, "vm"),
    imageDirectory: join(directory, "image"),
    toolsDirectory: join(directory, "tools"),
    scriptsDirectory: join(directory, "scripts"),
    resultsDirectory: join(directory, "results"),
    bundleDirectory: join(directory, "bundle"),
    artifactsDirectory: join(directory, "artifacts")
  }
  await Promise.all(Object.values(workspace).map((path) => mkdir(path, { recursive: true })))
  return workspace
})

const removeWorkspace = (workspace: Workspace): Effect.Effect<void> =>
  Effect.promise(() => rm(workspace.directory, { recursive: true, force: true }))
