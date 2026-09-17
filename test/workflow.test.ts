import assert from "node:assert/strict"
import test from "node:test"
import { Effect } from "effect"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCliConfig, type CliConfig } from "../src/config.js"
import { CommandFailure } from "../src/process.js"
import { artifactFileName, imageOciReference, isImageBundleFile, modelOciReference, modelOciReferenceForCoordinates, mooseImageUrl, ociReference, pharoFailureMessage, pharoVmUrl, planBuildModel, pulledImageDirectory, renderModelBuildStart, runtimeConfigForModelManifest, runtimeImageDirectory, runtimeVmDirectory, shouldCopyRecordedRepositoryPath } from "../src/workflow.js"

const config: CliConfig = {
  ...defaultCliConfig,
  pharo: { version: "12" },
  moose: { version: "12.0.0" },
  buildSpec: {
    coordinates: { group: "com.example", name: "demo", version: "1.0.0" },
    sourceDirectory: "/sources",
    projectKind: "unmanaged",
    language: "java",
    modelName: "demo-model"
  },
  oci: { registry: "registry.example.com", namespace: "team/moose" }
}

test("derives bootstrap URLs from configured versions", () => {
  assert.equal(pharoVmUrl(config), "https://get.pharo.org/64/vm120")
  assert.equal(
    mooseImageUrl(config),
    "https://github.com/moosetechnology/Moose/releases/download/v12.0.0/Moose12-stable-Pharo64-12.zip"
  )
})

test("stores provisioned VMs using the Pharo VM directory convention", () => {
  assert.equal(runtimeVmDirectory("12"), join(homedir(), ".moose", "runtime", "vms", "120-x64"))
})

test("keys trusted runtime images by every loaded runtime version", () => {
  assert.equal(
    runtimeImageDirectory(config),
    join(homedir(), ".moose", "runtime", "images", "moose-12.0.0-pharo-12-moosenexus-1.x.x")
  )
})

test("keeps the TypeScript runtime separate from the core runtime", () => {
  const typeScriptConfig: CliConfig = {
    ...config,
    buildSpec: {
      ...config.buildSpec,
      language: "typescript",
      ts2famix: {
        repository: "https://github.com/fuhrmanator/FamixTypeScriptImporter.git",
        revision: "679f54e7a0990791e8dce3e437ff4915baebfdc5"
      }
    }
  }

  assert.equal(
    runtimeImageDirectory(typeScriptConfig),
    join(homedir(), ".moose", "runtime", "images", "moose-12.0.0-pharo-12-moosenexus-1.x.x-typescript")
  )
  assert.notEqual(runtimeImageDirectory(typeScriptConfig), runtimeImageDirectory(config))
})

test("uses model artifact provenance to select an exact runtime", () => {
  const runtime = runtimeConfigForModelManifest({
    buildProvenance: {
      mooseNexusVersion: "0.5.0",
      mooseVersion: "12.0.0",
      pharoVersion: "12"
    }
  })

  assert.equal(runtime.moosenexus.version, "0.5.0")
  assert.equal(runtime.moosenexus.revision, "v0.5.0")
  assert.equal(runtime.moose.version, "12.0.0")
  assert.equal(runtime.pharo.version, "12")
})

test("rejects a model artifact without complete runtime provenance", () => {
  assert.throws(
    () => runtimeConfigForModelManifest({ buildProvenance: { mooseNexusVersion: "0.5.0" } }),
    /does not identify its MooseNexus, Moose, and Pharo runtime versions/
  )
})

test("reports the Pharo error without its stack trace", () => {
  const error = new CommandFailure("pharo", [], 1, "\u001B[31mError: Cannot merge model\nStack frame\n\u001B[0m")

  assert.equal(pharoFailureMessage(error), "Cannot merge model")
})

test("keeps Pharo error context before its stack trace", () => {
  const error = new CommandFailure("pharo", [], 1, [
    "Error: Maven artifact materialization failed:",
    "Could not download com.example:demo:1.0.0.",
    "MooseNexusMavenRepository>>materialize:"
  ].join("\n"))

  assert.equal(
    pharoFailureMessage(error),
    "Maven artifact materialization failed: Could not download com.example:demo:1.0.0."
  )
})

test("keeps the concise Pharo error without inferring its cause", () => {
  const error = new CommandFailure("pharo", [], 1, "KeyNotFound: key 'buildProvenance' not found in Dictionary\nDictionary>>at:")

  assert.equal(
    pharoFailureMessage(error),
    "KeyNotFound: key 'buildProvenance' not found in Dictionary"
  )
})

test("does not expose a Pharo stack when no error line is recognized", () => {
  const error = new CommandFailure("pharo", [], 1, "Dictionary>>at:\nMooseNexusProject>>install")

  assert.equal(pharoFailureMessage(error), "Pharo exited with code 1 without a usable diagnostic")
})

test("maps image artifacts to a coordinate-based OCI reference", () => {
  assert.equal(artifactFileName(config), "com.example-demo-1.0.0-image.zip")
  assert.equal(
    ociReference(config),
    "registry.example.com/team/moose/moosenexus/com.example/demo:1.0.0-image"
  )
  assert.equal(
    imageOciReference("registry.example.com", "team/moose", config.buildSpec.coordinates!),
    "registry.example.com/team/moose/moosenexus/com.example/demo:1.0.0-image"
  )
})

test("maps model artifacts to the coordinate tag", () => {
  assert.equal(
    modelOciReference(config),
    "registry.example.com/team/moose/moosenexus/com.example/demo:1.0.0"
  )
  assert.equal(
    modelOciReferenceForCoordinates("registry.example.com", "team/moose", config.buildSpec.coordinates!),
    "registry.example.com/team/moose/moosenexus/com.example/demo:1.0.0"
  )
})

test("plans a local-only model build without constructing an OCI reference", async () => {
  const localConfig: CliConfig = { ...config, oci: undefined }
  const plan = await Effect.runPromise(planBuildModel(localConfig))

  assert.match(renderModelBuildStart(plan), /Publish:    Skip OCI publication/)
})

test("uses the OCI reference to isolate pulled image bundles", () => {
  assert.equal(
    pulledImageDirectory("artifacts", { group: "com.example", name: "demo", version: "1.0.0" }),
    resolve("artifacts", "com.example-demo-1.0.0")
  )
})

test("keeps image launcher companions and excludes Git metadata from recorded sources", () => {
  const imagePath = "/bundle/Moose12.image"
  assert.equal(isImageBundleFile("Moose12.image", imagePath), true)
  assert.equal(isImageBundleFile("Moose12.changes", imagePath), true)
  assert.equal(isImageBundleFile("Pharo12.0-64bit.sources", imagePath), true)
  assert.equal(isImageBundleFile("meta-inf.ston", imagePath), true)
  assert.equal(isImageBundleFile("pharo.version", imagePath), true)
  assert.equal(isImageBundleFile("unrelated.txt", imagePath), false)

  const repositoryRoot = "/repository"
  assert.equal(shouldCopyRecordedRepositoryPath(repositoryRoot, join(repositoryRoot, "sources", "project", "src", "Main.java")), true)
  assert.equal(shouldCopyRecordedRepositoryPath(repositoryRoot, join(repositoryRoot, "sources", "project", "pharo-local", "iceberg", "source.st")), true)
  assert.equal(shouldCopyRecordedRepositoryPath(repositoryRoot, join(repositoryRoot, "sources", "project", ".git", "objects", "object")), false)
})
