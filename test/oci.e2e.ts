import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { access, chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const fixtureDirectory = join(projectDirectory, "test", "fixtures", "java-project")
const enabled = process.env.MOOSENEXUS_E2E === "1"
const zotImage = process.env.MOOSENEXUS_E2E_ZOT_IMAGE
  ?? (process.arch === "arm64"
    ? "ghcr.io/project-zot/zot-linux-arm64:latest"
    : "ghcr.io/project-zot/zot-linux-amd64:latest")

const e2e = enabled ? describe : describe.skip

e2e("OCI artifact workflows", () => {
  let fixture: E2eFixture

  before(async () => {
    fixture = await startFixture()
  })

  after(async () => {
    await fixture.stop()
  })

  it("publishes and pulls a model artifact through an OCI registry", async () => {
    const buildModel = await runCli(["build-model", ...fixture.buildArguments("hello")], fixture.environment)
    assert.match(buildModel, /Materialize a MooseNexus build spec/)
    assert.match(buildModel, /through MooseNexus and ORAS/)

    const publishModel = await runCli([
      "publish-model",
      `${fixture.repository}:hello:${fixture.version}`,
      "--registry", fixture.zot.registry,
      "--namespace", fixture.namespace
    ], fixture.environment)
    assert.match(publishModel, /Publish .* through MooseNexus and ORAS/)

    const pullModel = await runCli([
      "pull-model",
      "--registry", fixture.zot.registry,
      "--namespace", fixture.namespace,
      "--project-group", fixture.repository,
      "--project-name", "hello",
      "--project-version", fixture.version
    ], fixture.environment)
    assert.match(pullModel, /Install the model into the default MooseNexus repository/)
    await access(join(fixture.environment.HOME!, ".moose", "repository", fixture.repository, "hello", fixture.version, "metadata", "models.json"))
  })

  it("publishes and pulls an image artifact through an OCI registry", async () => {
    const projectName = "image"
    const buildImage = await runCli(["build-image", "--out", join(fixture.temporaryDirectory, "artifacts"), ...fixture.buildArguments(projectName)], fixture.environment)
    assert.match(buildImage, /- Reuse cached Pharo 12 VM/)
    assert.match(buildImage, /Package the saved image/)
    assert.match(buildImage, /through ORAS/)

    const publishImage = await runCli([
      "publish-image",
      `${fixture.repository}:${projectName}:${fixture.version}`,
      "--registry", fixture.zot.registry,
      "--namespace", fixture.namespace
    ], fixture.environment)
    assert.match(publishImage, /Publish .* through ORAS/)

    const archive = (await readdir(join(fixture.temporaryDirectory, "artifacts"))).find((file) => file.endsWith(".zip"))
    assert.notEqual(archive, undefined)
    const archiveContents = await runProcess("unzip", ["-Z1", join(fixture.temporaryDirectory, "artifacts", archive!)], fixture.environment)
    assert.match(archiveContents, /hello-model\.image/)
    assert.doesNotMatch(archiveContents, /Moose.*\.image/)

    const outputDirectory = join(fixture.temporaryDirectory, "images")
    const pullImage = await runCli([
      "pull-image",
      "--registry", fixture.zot.registry,
      "--namespace", fixture.namespace,
      "--project-group", fixture.repository,
      "--project-name", projectName,
      "--project-version", fixture.version,
      "--out", outputDirectory
    ], fixture.environment)
    assert.match(pullImage, /Install project metadata with the local MooseNexus runtime/)
    assert.match(pullImage, /Rebase model sources in the image/)

    const installedProject = join(outputDirectory, `${fixture.repository}-${projectName}-${fixture.version}`, "pharo-local", "MooseNexus", "repository", fixture.repository, projectName, fixture.version)
    await access(join(installedProject, "sources", "main", "src", "main", "java", "example", "Hello.java"))
    assert.deepEqual(
      await readFile(join(installedProject, "metadata", "images.json"), "utf8").then(JSON.parse),
      [{ name: "hello-model", modelArtifact: "hello-model" }]
    )
    const imageDirectory = join(installedProject, "artifacts", "images", "hello-model")
    const imageFile = "hello-model.image"
    await access(join(imageDirectory, imageFile))
    const verificationScript = join(fixture.temporaryDirectory, "verify-image-root.st")
    await writeFile(verificationScript, [
      "| model expected |",
      `expected := '${smalltalkString(join(installedProject, "sources"))}' asFileReference pathString.`,
      "model := MooseModel root allModels detect: [ :each | each name = 'hello-model' ] ifNone: [ Error signal: 'Missing loaded model: hello-model' ].",
      "model rootFolder pathString = expected ifFalse: [ Error signal: 'Unexpected model root folder: ' , model rootFolder pathString ].",
      "Smalltalk snapshot: false andQuit: true"
    ].join("\n") + "\n")
    await runProcess(await cachedPharoExecutable(fixture.runtimeDirectory), [join(imageDirectory, imageFile!), "st", verificationScript], fixture.environment)

    const adoptedImage = await runCli([
      "pull-image",
      "--registry", fixture.zot.registry,
      "--namespace", fixture.namespace,
      "--project-group", fixture.repository,
      "--project-name", projectName,
      "--project-version", fixture.version,
      "--adopt-as", "hello-analysis"
    ], fixture.environment)
    assert.match(adoptedImage, /Adopt the image into/)
    await access(join(fixture.environment.HOME!, "Documents", "Pharo", "images", "hello-analysis", "hello-analysis.image"))
    const repositoryImageDirectory = join(fixture.environment.HOME!, ".moose", "repository", fixture.repository, projectName, fixture.version, "artifacts", "images", "hello-model")
    const repositoryImage = (await readdir(repositoryImageDirectory)).find((file) => file.endsWith(".image"))
    assert.notEqual(repositoryImage, undefined)
    assert.equal((await stat(join(repositoryImageDirectory, repositoryImage!))).mode & 0o222, 0)

    await assert.rejects(
      () => runCli([
        "pull-image",
        "--registry", fixture.zot.registry,
        "--namespace", fixture.namespace,
        "--project-group", fixture.repository,
        "--project-name", projectName,
        "--project-version", fixture.version,
        "--force",
        "--adopt-as", "hello-analysis"
      ], fixture.environment),
      /The image artifact remains installed in the MooseNexus repository\.\nAdopt it later with:\nmoosenexus adopt-image/
    )
  })
})

type E2eFixture = {
  readonly buildArguments: (projectName: string) => ReadonlyArray<string>
  readonly environment: NodeJS.ProcessEnv
  readonly namespace: string
  readonly repository: string
  readonly runtimeDirectory: string
  readonly stop: () => Promise<void>
  readonly temporaryDirectory: string
  readonly version: string
  readonly zot: ZotFixture
}

const startFixture = async (): Promise<E2eFixture> => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "moosenexus-cli-e2e-"))
  const repository = `org.moosenexus.cli.e2e.${Date.now()}`
  const namespace = "moosenexus-cli-e2e"
  const version = "0.0.1"
  const runtimeDirectory = process.env.MOOSENEXUS_E2E_RUNTIME_DIRECTORY ?? join(homedir(), ".moose", "runtime")
  const nexusVersion = process.env.MOOSENEXUS_E2E_NEXUS_VERSION
  const environment = {
    ...process.env,
    HOME: join(temporaryDirectory, "home"),
    MOOSENEXUS_RUNTIME_DIRECTORY: runtimeDirectory
  }
  const zot = await startZot()
  const buildArguments = (projectName: string): ReadonlyArray<string> => [
    "--project-group", repository,
    "--project-name", projectName,
    "--project-version", version,
    "--source", fixtureDirectory,
    "--pharo", "12",
    "--kind", "unmanaged",
    "--language", "java",
    "--model-name", "hello-model",
    "--registry", zot.registry,
    "--namespace", namespace,
    ...(nexusVersion === undefined ? [] : ["--nexus-version", nexusVersion]),
    "--", "--runner", "docker", "--version", "v4.1.4", "-format", "json", "-anchor", "assoc"
  ]

  return {
    buildArguments,
    environment,
    namespace,
    repository,
    runtimeDirectory,
    stop: async () => {
      await zot.stop()
      await makeWritable(temporaryDirectory)
      await rm(temporaryDirectory, { recursive: true, force: true })
    },
    temporaryDirectory,
    version,
    zot
  }
}

type ZotFixture = {
  readonly registry: string
  readonly stop: () => Promise<void>
}

const startZot = async (): Promise<ZotFixture> => {
  const containerName = `moosenexus-cli-e2e-${randomUUID()}`

  await runProcess("docker", [
    "run", "--detach", "--rm",
    "--name", containerName,
    "--publish", "127.0.0.1::5000",
    zotImage
  ], process.env)

  try {
    const port = (await runProcess("docker", [
      "inspect",
      "--format", "{{(index (index .NetworkSettings.Ports \"5000/tcp\") 0).HostPort}}",
      containerName
    ], process.env)).trim()
    const registry = `localhost:${port}`
    await waitForRegistry(`http://127.0.0.1:${port}/v2/`)

    return {
      registry,
      stop: async () => {
        try {
          await runProcess("docker", ["stop", containerName], process.env)
        } catch {
          // The fixture may already have stopped after a failed test.
        }
      }
    }
  } catch (error) {
    await runProcess("docker", ["stop", containerName], process.env).catch(() => undefined)
    throw error
  }
}

const waitForRegistry = async (url: string): Promise<void> => {
  const deadline = Date.now() + 30_000
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`Registry responded with HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100))
  }

  throw new Error(`Zot registry did not become ready at ${url}: ${String(lastError)}`)
}

const cachedPharoExecutable = async (runtimeDirectory: string): Promise<string> => {
  const vmDirectory = join(runtimeDirectory, "vms")
  for (const entry of await readdir(vmDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue

    const executable = join(vmDirectory, entry.name, "pharo")
    try {
      await access(executable)
      return executable
    } catch {
      // Continue until a cached VM executable is found.
    }
  }

  throw new Error(`Could not find a cached Pharo VM under ${vmDirectory}.`)
}

const makeWritable = async (directory: string): Promise<void> => {
  await chmod(directory, 0o755)
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return makeWritable(path)
    if (entry.isFile()) await chmod(path, 0o644)
  }))
}

const runCli = (arguments_: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): Promise<string> =>
  runProcess(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts", ...arguments_], environment)

const runProcess = (command: string, arguments_: ReadonlyArray<string>, environment: NodeJS.ProcessEnv): Promise<string> =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: projectDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.on("error", reject)
    child.on("close", (code) => code === 0 ? resolvePromise(output) : reject(new Error(output)))
  })

const smalltalkString = (value: string): string => value.replaceAll("'", "''")
