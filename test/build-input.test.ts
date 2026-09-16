import assert from "node:assert/strict"
import test from "node:test"
import { Effect, Option } from "effect"
import * as Schema from "effect/Schema"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { resolveBuildImageConfig, resolveBuildModelConfig, validateBuildRuntime, type BuildImageCommandInput } from "../src/build-input.js"
import { CliConfig, defaultCliConfig } from "../src/config.js"

const inlineInput = (overrides: Partial<BuildImageCommandInput>): BuildImageCommandInput => ({
  config: Option.none(),
  dryRun: false,
  pharoVersion: Option.none(),
  pharoVmUrl: Option.none(),
  mooseVersion: Option.none(),
  mooseImageUrl: Option.none(),
  mooseNexusRepository: Option.none(),
  mooseNexusVersion: Option.none(),
  specFile: Option.none(),
  coordinates: Option.none(),
  source: Option.none(),
  projectGroup: Option.some("com.example"),
  projectName: Option.some("demo"),
  projectVersion: Option.some("1.0.0"),
  sourceDirectory: Option.some("/source"),
  projectKind: Option.some("unmanaged"),
  language: Option.some("Java"),
  dependencyDirectory: Option.none(),
  modelName: Option.none(),
  description: Option.none(),
  outputDirectory: Option.none(),
  noInstall: false,
  keepWorkspace: false,
  ociRegistry: Option.none(),
  ociNamespace: Option.none(),
  ...overrides
})

test("normalizes language identifiers before generating a MooseNexus build", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({})))

  assert.equal(config.buildSpec.language, "java")
  assert.equal(config.artifact.outputDirectory, undefined)
})

test("configures a build from compact project coordinates", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    coordinates: Option.some("com.example:backend:1.2.3"),
    projectGroup: Option.none(),
    projectName: Option.none(),
    projectVersion: Option.none()
  })))

  assert.deepEqual(config.buildSpec.coordinates, { group: "com.example", name: "backend", version: "1.2.3" })
})

test("configures a build from a positional source directory", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    source: Option.some("~/source"),
    sourceDirectory: Option.none()
  })))

  assert.equal(config.buildSpec.sourceDirectory, join(homedir(), "source"))
})

test("rejects positional and named source directories together", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildImageConfig(inlineInput({
      source: Option.some("/positional-source")
    }))),
    /Use either the positional source directory or --source/
  )
})

test("completes abbreviated Moose release versions", async () => {
  const majorOnly = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    mooseVersion: Option.some("12")
  })))
  const majorAndMinor = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    mooseVersion: Option.some("12.3")
  })))

  assert.equal(majorOnly.moose.version, "12.0.0")
  assert.equal(majorAndMinor.moose.version, "12.3.0")
})

test("configures the pinned ts2famix runner for TypeScript builds", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    language: Option.some("TypeScript"),
    projectKind: Option.some("auto")
  })))

  assert.equal(config.buildSpec.language, "typescript")
  assert.deepEqual(config.buildSpec.ts2famix, {
    repository: "https://github.com/fuhrmanator/FamixTypeScriptImporter.git",
    revision: "679f54e7a0990791e8dce3e437ff4915baebfdc5"
  })
  assert.equal(config.buildSpec.verveineJ, undefined)
})

test("rejects a TypeScript build on an unsupported Moose version", async () => {
  await assert.rejects(
    () => Effect.runPromise(validateBuildRuntime({
      ...defaultCliConfig,
      moose: { version: "12.0.0" },
      buildSpec: {
        ...defaultCliConfig.buildSpec,
        language: "typescript"
      }
    })),
    /TypeScript support requires Moose 13 or later/
  )
})

test("rejects a local JAR directory before MooseNexus v1", async () => {
  await assert.rejects(
    () => Effect.runPromise(validateBuildRuntime({
      ...defaultCliConfig,
      moosenexus: { ...defaultCliConfig.moosenexus, version: "0.8.0" },
      buildSpec: {
        ...defaultCliConfig.buildSpec,
        projectKind: "unmanaged",
        dependencyDirectory: "/dependencies/local-jars"
      }
    })),
    /--dependency-directory requires MooseNexus 1\.0\.0 or later/
  )
})

test("rejects builds without the headless operation result contract", async () => {
  await assert.rejects(
    () => Effect.runPromise(validateBuildRuntime({
      ...defaultCliConfig,
      moosenexus: { ...defaultCliConfig.moosenexus, version: "1.0.1" }
    })),
    /requires MooseNexus 1\.1\.0 or later/
  )
})

test("defaults omitted runtime settings in a YAML configuration", () => {
  const config = Schema.decodeUnknownSync(CliConfig)({})

  assert.equal(config.pharo.version, "latest")
  assert.equal(config.moose.version, "latest")
  assert.equal(config.moosenexus.version, "1.1.x")
})

test("accepts an unmanaged local JAR directory in a YAML configuration", () => {
  const config = Schema.decodeUnknownSync(CliConfig)({
    buildSpec: {
      projectKind: "unmanaged",
      dependencyDirectory: "/dependencies/local-jars"
    }
  })

  assert.equal(config.buildSpec.dependencyDirectory, "/dependencies/local-jars")
})

test("allows a model build to obtain its coordinates from an external spec", async () => {
  const config = await Effect.runPromise(resolveBuildModelConfig(inlineInput({
    config: Option.some({
      ...defaultCliConfig,
      oci: { registry: "registry.example.com", namespace: "team/moose" }
    }),
    specFile: Option.some("/specs/demo.st"),
    projectGroup: Option.none(),
    projectName: Option.none(),
    projectVersion: Option.none(),
    sourceDirectory: Option.none(),
    projectKind: Option.none(),
    language: Option.none()
  })))

  assert.equal(config.buildSpec.file, "/specs/demo.st")
  assert.equal(config.buildSpec.coordinates, undefined)
})

test("leaves an external build spec in control of its model description", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildModelConfig(inlineInput({
      specFile: Option.some("/specs/demo.st"),
      description: Option.some("Demo analysis")
    }))),
    /external build spec script configures its own model description/
  )
})

test("rejects duplicate model coordinates for an external spec", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildModelConfig(inlineInput({
      config: Option.some({
        ...defaultCliConfig,
        oci: { registry: "registry.example.com", namespace: "team/moose" }
      }),
      specFile: Option.some("/specs/demo.st")
    }))),
    /defines its own coordinates/
  )
})

test("expands a source directory relative to the current user home", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    sourceDirectory: Option.some("~/Documents/forge/backend")
  })))

  assert.equal(config.buildSpec.sourceDirectory, join(homedir(), "Documents/forge/backend"))
})

test("resolves source directories relative to the CLI invocation directory", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    sourceDirectory: Option.some("test/fixtures/java-project")
  })))

  assert.equal(config.buildSpec.sourceDirectory, resolve("test/fixtures/java-project"))
})

test("configures a local JAR directory for an unmanaged project", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    dependencyDirectory: Option.some("~/dependencies")
  })))

  assert.equal(config.buildSpec.dependencyDirectory, join(homedir(), "dependencies"))
})

test("configures an inline model description", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    description: Option.some("Demo analysis")
  })))

  assert.equal(config.buildSpec.description, "Demo analysis")
})

test("rejects a local JAR directory for a managed project", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildImageConfig(inlineInput({
      dependencyDirectory: Option.some("/dependencies"),
      projectKind: Option.some("managed")
    }))),
    /--dependency-directory requires --kind unmanaged/
  )
})

test("rejects keeping a workspace for a dry run", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildImageConfig(inlineInput({ dryRun: true, keepWorkspace: true }))),
    /--keep cannot be used with --dry-run/
  )
})

test("requires a durable output when local installation is disabled", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildImageConfig(inlineInput({ noInstall: true }))),
    /--no-install requires --out or an OCI registry and namespace/
  )
})

test("allows repository-less builds with an explicit export", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({
    noInstall: true,
    outputDirectory: Option.some("./artifacts")
  })))

  assert.equal(config.artifact.outputDirectory, "./artifacts")
})

test("configures the local VerveineJ runner", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(
    inlineInput({}),
    ["--runner", "local", "--directory", "/tools/VerveineJ"]
  ))

  assert.deepEqual(config.buildSpec.verveineJ, {
    runner: "local",
    directory: "/tools/VerveineJ"
  })
})

test("rejects a local extractor without its VerveineJ directory", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildImageConfig(inlineInput({}), ["--runner", "local"])),
    /--runner local requires --directory after --/
  )
})

test("uses Docker when a VerveineJ version is supplied without a runner", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({}), ["--version", "2.0.0"]))

  assert.deepEqual(config.buildSpec.verveineJ, { runner: "docker", version: "2.0.0" })
})

test("configures every VerveineJ option and infers the Docker runner", async () => {
  const config = await Effect.runPromise(resolveBuildImageConfig(inlineInput({}), [
    "-format", "mse",
    "-alllocals",
    "-anchor", "entity",
    "-excludepath", "**/generated/**",
    "-excludepath", "**/test/**",
    "-17",
    "--jvm-args", "-Xmx4g",
    "-summary"
  ]))

  assert.deepEqual(config.buildSpec.verveineJ, {
    runner: "docker",
    format: "mse",
    allLocals: true,
    anchor: "entity",
    excludePaths: ["**/generated/**", "**/test/**"],
    javaVersion: "17",
    jvmArgs: "-Xmx4g",
    summary: true
  })
})

test("reports extractor option errors through the build configuration", async () => {
  await assert.rejects(
    () => Effect.runPromise(resolveBuildImageConfig(inlineInput({}), ["--unknown"])),
    /Unknown VerveineJ option after --: --unknown/
  )
})
