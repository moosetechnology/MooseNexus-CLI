import assert from "node:assert/strict"
import test from "node:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")

test("pull-image restores and validates an OCI image bundle", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "moosenexus-cli-pull-test-"))
  try {
    const bundleDirectory = join(temporaryDirectory, "bundle")
    const binDirectory = join(temporaryDirectory, "bin")
    const archivePath = join(temporaryDirectory, "artifact.zip")
    const outputDirectory = join(temporaryDirectory, "output")
    const destination = join(outputDirectory, "com.example-demo-1.0.0")
    const installedProjectDirectory = join(destination, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0")
    const runtimeDirectory = join(temporaryDirectory, "runtime")
    await mkdir(bundleDirectory)
    await mkdir(binDirectory)
    await mkdir(join(runtimeDirectory, "vms", "120-x64"), { recursive: true })
    await mkdir(join(runtimeDirectory, "releases"), { recursive: true })
    await writeFile(join(runtimeDirectory, "releases", "nexus-v1.x.x.json"), JSON.stringify({
      repository: "moosetechnology/MooseNexus",
      tag: "v1.x.x",
      revision: "0123456789abcdef",
      resolvedAt: new Date().toISOString()
    }) + "\n")
    await mkdir(join(runtimeDirectory, "images", "moose-12.0.0-pharo-12-moosenexus-0123456789abcdef"), { recursive: true })
    await writeFile(join(runtimeDirectory, "images", "moose-12.0.0-pharo-12-moosenexus-0123456789abcdef", "manager.image"), "manager")
    await writeFile(join(bundleDirectory, "example.image"), "image")
    await mkdir(join(bundleDirectory, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0", "metadata"), { recursive: true })
    await writeFile(join(bundleDirectory, "example.changes"), "changes")
    await writeFile(join(bundleDirectory, "meta-inf.ston"), [
      "PhLImage {",
      "  #vmManager : PhLVirtualMachineManager {",
      "    #imageFile : FileLocator {",
      "      #path : RelativePath [ 'example', 'example.image' ]",
      "    }",
      "  }",
      "}",
      ""
    ].join("\n"))
    await writeFile(join(bundleDirectory, "moosenexus-cli-report.json"), JSON.stringify({
      moosenexusRevision: "v0.1.0",
      moosenexusVersion: "0.1.0",
      mooseVersion: "12.0.0",
      pharoVersion: "12"
    }) + "\n")
    await writeFile(join(bundleDirectory, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0", "metadata", "models.json"), JSON.stringify([{
      modelArtifact: { artifactCoordinates: { name: "demo-model" } }
    }]) + "\n")
    await writeFile(join(bundleDirectory, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0", "metadata", "images.json"), "[]\n")
    await mkdir(join(installedProjectDirectory, "metadata"), { recursive: true })
    await writeFile(join(installedProjectDirectory, "metadata", "models.json"), JSON.stringify([{
      modelArtifact: { artifactCoordinates: { name: "demo-model" } }
    }]) + "\n")
    await writeFile(join(installedProjectDirectory, "metadata", "images.json"), "[]\n")
    await run("zip", ["-q", "-r", archivePath, "."], bundleDirectory)

    const orasPath = join(binDirectory, "oras")
    await writeFile(orasPath, "#!/bin/sh\nmkdir -p \"$3\"\ncp \"$FIXTURE_ARCHIVE\" \"$3/artifact.zip\"\n")
    await chmod(orasPath, 0o755)
    const pharoPath = join(runtimeDirectory, "vms", "120-x64", "pharo")
    await writeFile(pharoPath, [
      "#!/bin/sh",
      "result=$(sed -n \"s/.*writeTo: '\\([^']*\\)' asFileReference.*/\\1/p\" \"$3\")",
      "if [ -n \"$result\" ]; then",
      "  mkdir -p \"$(dirname \"$result\")\"",
      "  printf '%s\\n' '{\"schemaVersion\":\"1\",\"operation\":\"install-project\",\"phase\":\"install\",\"status\":\"success\",\"code\":\"ok\",\"message\":null,\"context\":{}}' > \"$result\"",
      "fi",
      "exit 0"
    ].join("\n"))
    await chmod(pharoPath, 0o755)

    const result = await run(
      process.execPath,
      [
        "node_modules/tsx/dist/cli.mjs", "src/index.ts", "pull-image",
        "--registry", "registry.example.com",
        "--namespace", "moose",
        "--project-group", "com.example",
        "--project-name", "demo",
        "--project-version", "1.0.0",
        "--out", outputDirectory
      ],
      projectDirectory,
      {
        ...process.env,
        FIXTURE_ARCHIVE: archivePath,
        MOOSENEXUS_RUNTIME_DIRECTORY: runtimeDirectory,
        PATH: `${binDirectory}:${process.env.PATH}`
      }
    )

    assert.match(result, /MooseNexus pull-image\n\nReference:.*\nDestination:/i)
    assert.match(result, /image artifact pulled successfully/i)
    assert.match(result, /Image: .*artifacts\/images\/demo-model\/demo-model\.image/)
    assert.equal(await readFile(join(destination, "example.image"), "utf8"), "image")
    assert.equal(JSON.parse(await readFile(join(destination, "moosenexus-cli-report.json"), "utf8")).moosenexusVersion, "0.1.0")
    assert.equal(
      await readFile(join(destination, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0", "artifacts", "images", "demo-model", "demo-model.image"), "utf8"),
      "image"
    )
    assert.equal(
      await readFile(join(destination, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0", "artifacts", "images", "demo-model", "demo-model.changes"), "utf8"),
      "changes"
    )
    assert.match(
      await readFile(join(destination, "pharo-local", "MooseNexus", "repository", "com.example", "demo", "1.0.0", "artifacts", "images", "demo-model", "meta-inf.ston"), "utf8"),
      /RelativePath \[ 'demo-model', 'demo-model\.image' \]/
    )
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
})

const run = (
  command: string,
  arguments_: ReadonlyArray<string>,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolvePromise(output) : reject(new Error(output)))
  })
