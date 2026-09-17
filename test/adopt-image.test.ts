import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")

test("adopt-image creates a renamed launcher image without replacing an existing copy", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "moosenexus-cli-adopt-test-"))
  try {
    const homeDirectory = join(temporaryDirectory, "home")
    const artifactDirectory = join(
      homeDirectory,
      ".moose",
      "repository",
      "com.example",
      "demo",
      "1.0.0",
      "artifacts",
      "images",
      "demo-model"
    )
    const metadataDirectory = join(homeDirectory, ".moose", "repository", "com.example", "demo", "1.0.0", "metadata")
    await mkdir(artifactDirectory, { recursive: true })
    await mkdir(metadataDirectory, { recursive: true })
    await writeFile(join(metadataDirectory, "images.json"), JSON.stringify([
      { name: "demo-model", modelArtifact: "demo-model" }
    ]) + "\n")
    await writeFile(join(artifactDirectory, "artifact.image"), "image")
    await writeFile(join(artifactDirectory, "artifact.changes"), "changes")
    await writeFile(join(artifactDirectory, "Pharo13.sources"), "sources")
    await writeFile(join(artifactDirectory, "pharo.version"), "130")
    await writeFile(join(artifactDirectory, "meta-inf.ston"), [
      "PhLImage {",
      "  #vmManager : PhLVirtualMachineManager {",
      "    #imageFile : FileLocator {",
      "      #path : RelativePath [ 'artifact', 'artifact.image' ]",
      "    }",
      "  }",
      "}"
    ].join("\n"))
    await Promise.all([
      "artifact.image",
      "artifact.changes",
      "Pharo13.sources",
      "pharo.version",
      "meta-inf.ston"
    ].map((file) => chmod(join(artifactDirectory, file), 0o444)))

    const environment = { ...process.env, HOME: homeDirectory }
    const arguments_ = [
      "node_modules/tsx/dist/cli.mjs", "src/index.ts", "adopt-image",
      "--project-group", "com.example",
      "--project-name", "demo",
      "--project-version", "1.0.0",
      "--adopt-as", "demo-analysis"
    ]
    const result = await run(process.execPath, arguments_, environment)
    const destination = join(homeDirectory, "Documents", "Pharo", "images", "demo-analysis")

    assert.match(result, /image artifact adopted successfully/i)
    assert.equal(await readFile(join(destination, "demo-analysis.image"), "utf8"), "image")
    assert.equal(await readFile(join(destination, "demo-analysis.changes"), "utf8"), "changes")
    assert.equal(await readFile(join(destination, "Pharo13.sources"), "utf8"), "sources")
    assert.notEqual((await stat(join(destination, "demo-analysis.image"))).mode & 0o222, 0)
    assert.match(await readFile(join(destination, "meta-inf.ston"), "utf8"), /RelativePath \[ 'demo-analysis', 'demo-analysis\.image' \]/)

    const defaultArguments_ = arguments_.slice(0, -2)
    await run(process.execPath, defaultArguments_, environment)
    const defaultDestination = join(homeDirectory, "Documents", "Pharo", "images", "demo-model")
    assert.equal(await readFile(join(defaultDestination, "demo-model.image"), "utf8"), "image")

    await assert.rejects(
      () => run(process.execPath, arguments_, environment),
      /Cannot adopt image because the destination already exists/
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

const run = (command: string, arguments_: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd: projectDirectory, env: environment, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolvePromise(output) : reject(new Error(output)))
  })
