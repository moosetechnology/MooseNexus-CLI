import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")

test("writes one build plan to standard output with --json", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "moosenexus-json-result-"))
  try {
    const result = await runCli([
      "build-model",
      "com.example:demo:1.0.0",
      "/source",
      "--kind", "unmanaged",
      "--language", "java",
      "--pharo", "12",
      "--moose", "12",
      "--nexus-version", "1.1.0",
      "--dry-run",
      "--json"
    ], { MOOSENEXUS_RUNTIME_DIRECTORY: join(temporaryDirectory, "runtime") })

    assert.equal(result.stderr, "")
    const rendered = JSON.parse(result.stdout) as {
      readonly schemaVersion: string
      readonly operation: string
      readonly status: string
      readonly plan: {
        readonly config: { readonly moosenexus: { readonly version: string } }
        readonly steps: ReadonlyArray<{ readonly name: string }>
      }
    }
    assert.equal(rendered.schemaVersion, "1")
    assert.equal(rendered.operation, "build-model")
    assert.equal(rendered.status, "planned")
    assert.equal(rendered.plan.config.moosenexus.version, "1.1.0")
    assert.deepEqual(rendered.plan.steps.map((step) => step.name), [
      "workspace", "pharo-vm", "moose-image", "load-moosenexus", "execute-spec", "export", "install", "publish"
    ])
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

const runCli = (
  arguments_: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv
): Promise<{ readonly stderr: string; readonly stdout: string }> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts", ...arguments_], {
      cwd: projectDirectory,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"]
    })
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(new Error(stderr)))
  })
