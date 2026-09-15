import assert from "node:assert/strict"
import test from "node:test"
import { defaultCliConfig, type CliConfig } from "../src/config.js"
import { externalBuildScript, externalModelBuildScript, inlineBuildScript, inlineModelBuildScript, installImageProjectScript, installModelBundleScript, loadMooseNexusScript, publishModelScript, rebaseImageModelScript } from "../src/scripts.js"

const config: CliConfig = {
  ...defaultCliConfig,
  moosenexus: {
    ...defaultCliConfig.moosenexus,
    version: "0.1.0",
    revision: "v0.1.0"
  },
  buildSpec: {
    coordinates: { group: "com.example", name: "demo", version: "1.0.0" },
    sourceDirectory: "/sources/it's-a-demo",
    projectKind: "unmanaged",
    language: "java",
    modelName: "demo-model",
    description: "Demo analysis",
    verveineJ: {
      runner: "local",
      directory: "/tools/VerveineJ"
    }
  }
}

test("loads the configured MooseNexus baseline from a source repository", () => {
  const script = loadMooseNexusScript(config)

  assert.match(script, /github:\/\/moosetechnology\/MooseNexus:v0.1.0\/src/)
  assert.match(script, /baseline: 'MooseNexus'/)
  assert.doesNotMatch(script, /load: 'TypeScript'/)
  assert.match(script, /Smalltalk snapshot: true andQuit: true/)
})

test("loads TypeScript support only for TypeScript builds", () => {
  const script = loadMooseNexusScript({
    ...config,
    buildSpec: {
      ...config.buildSpec,
      language: "typescript",
      verveineJ: undefined,
      ts2famix: {
        repository: "https://github.com/fuhrmanator/FamixTypeScriptImporter.git",
        revision: "679f54e7a0990791e8dce3e437ff4915baebfdc5"
      }
    }
  })

  assert.match(script, /load: 'TypeScript'/)
  assert.equal((script.match(/Metacello new/g) ?? []).length, 2)
})

test("materializes an unmanaged build and imports its model before saving", () => {
  const script = inlineBuildScript(config)

  assert.match(script, /MooseNexusUnmanagedProjectImporter/)
  assert.match(script, /repository := MooseNexusRepository imageLocal/)
  assert.match(script, /sourceDirectory: '\/sources\/it''s-a-demo' asFileReference/)
  assert.match(script, /spec modelComment: 'Demo analysis'/)
  assert.doesNotMatch(script, /mooseVersion:/)
  assert.match(script, /result project importModel: result modelArtifact/)
  assert.match(script, /extractor := MooseNexusLocalVerveineJRunner new/)
  assert.match(script, /extractor directory: '\/tools\/VerveineJ'/)
  assert.match(script, /Smalltalk snapshot: true andQuit: true/)
})

test("configures an unmanaged importer with a local JAR directory", () => {
  const script = inlineBuildScript({
    ...config,
    buildSpec: {
      ...config.buildSpec,
      dependencyDirectory: "/dependencies/local-jars"
    }
  })

  assert.match(script, /\tdependencyDirectory: '\/dependencies\/local-jars';/)
})

test("configures the selected VerveineJ Docker image version", () => {
  const script = inlineBuildScript({
    ...config,
    buildSpec: {
      ...config.buildSpec,
      verveineJ: { runner: "docker", version: "2.0.0" }
    }
  })

  assert.match(script, /extractor := MooseNexusDockerVerveineJRunner new/)
  assert.match(script, /extractor version: '2.0.0'/)
})

test("materializes every configured VerveineJ runner option", () => {
  const script = inlineBuildScript({
    ...config,
    buildSpec: {
      ...config.buildSpec,
      verveineJ: {
        runner: "docker",
        format: "mse",
        allLocals: true,
        anchor: "assoc",
        excludePaths: ["**/generated/**", "**/test's/**"],
        javaVersion: "17",
        jvmArgs: "-Xmx4g -Dfile.encoding=UTF-8",
        summary: true
      }
    }
  })

  assert.match(script, /extractor format: #mse/)
  assert.match(script, /extractor allLocals: true/)
  assert.match(script, /extractor anchor: #assoc/)
  assert.match(script, /extractor excludePaths: #\('\*\*\/generated\/\*\*' '\*\*\/test''s\/\*\*'\)/)
  assert.match(script, /extractor javaVersion: '17'/)
  assert.match(script, /extractor jvmArgs: '-Xmx4g -Dfile.encoding=UTF-8'/)
  assert.match(script, /extractor summary: true/)
})

test("materializes a model build without publishing it", () => {
  const script = inlineModelBuildScript({
    ...config,
    oci: { registry: "registry.example.com", namespace: "team/moose" }
  })

  assert.match(script, /result := spec executeIn: repository/)
  assert.doesNotMatch(script, /MooseNexusOciArtifactPublisher/)
  assert.doesNotMatch(script, /publishManifest:/)
  assert.doesNotMatch(script, /importModel:/)
  assert.match(script, /Smalltalk snapshot: false andQuit: true/)
})

test("configures a workspace-local ts2famix runner for TypeScript builds", () => {
  const script = inlineBuildScript({
    ...config,
    buildSpec: {
      ...config.buildSpec,
      language: "typescript",
      verveineJ: undefined,
      ts2famix: {
        repository: "https://github.com/fuhrmanator/FamixTypeScriptImporter.git",
        revision: "679f54e7a0990791e8dce3e437ff4915baebfdc5"
      }
    }
  }, "'/usr/local/bin/node' '/workspace/tools/ts2famix/dist/ts2famix-cli-wrapper.js'")

  assert.match(script, /spec language: 'typescript'/)
  assert.match(script, /extractor := MooseNexusLocalTypeScriptRunner new/)
  assert.match(script, /extractor command: '''\/usr\/local\/bin\/node'' ''\/workspace\/tools\/ts2famix\/dist\/ts2famix-cli-wrapper\.js'''/)
  assert.doesNotMatch(script, /MooseNexusDockerTypeScriptRunner/)
})

test("executes an external build spec in the image-local CLI repository", () => {
  const script = externalBuildScript("MooseNexusBuildSpec new")

  assert.match(script, /repository := MooseNexusRepository imageLocal/)
  assert.match(script, /spec := \[\nMooseNexusBuildSpec new\n\] value/)
  assert.match(script, /spec isKindOf: MooseNexusBuildSpec/)
  assert.match(script, /result project importModel: result modelArtifact/)
})

test("executes an external model build spec without importing its model", () => {
  const script = externalModelBuildScript("MooseNexusBuildSpec new")

  assert.match(script, /result := spec executeIn: repository/)
  assert.doesNotMatch(script, /importModel:/)
})

test("publishes a recorded model through MooseNexus", () => {
  const script = publishModelScript({
    ...config,
    oci: { registry: "registry.example.com", namespace: "team/moose" }
  })

  assert.match(script, /repository projects size = 1/)
  assert.match(script, /project := repository projects first/)
  assert.match(script, /project modelManifests size = 1/)
  assert.match(script, /manifest := project modelManifests first/)
  assert.match(script, /MooseNexusOciArtifactPublisher/)
  assert.match(script, /registry: 'registry.example.com'/)
  assert.match(script, /namespace: 'team\/moose'/)
  assert.match(script, /publisher publishManifest: manifest of: project/)
  assert.match(script, /Smalltalk snapshot: false andQuit: true/)
})

test("installs an image project into an explicit image-scoped repository", () => {
  const script = installImageProjectScript("/staging/project", false, "/images/example/pharo-local/MooseNexus")

  assert.match(script, /MooseNexusRepository new directory: '\/images\/example\/pharo-local\/MooseNexus' asFileReference/)
  assert.match(script, /installer installProjectDirectory: '\/staging\/project' asFileReference in: repository\./)
  assert.match(script, /Smalltalk snapshot: false andQuit: true/)
})

test("installs a downloaded model bundle into an explicit repository", () => {
  const script = installModelBundleScript("/staging/bundle", true, "/repositories/moose")

  assert.match(script, /MooseNexusOciArtifactInstaller new/)
  assert.match(script, /repository := MooseNexusRepository new directory: '\/repositories\/moose' asFileReference/)
  assert.match(script, /installBundleFrom: '\/staging\/bundle' asFileReference in: repository force: true/)
})

test("installs a staged image project through the MooseNexus directory installer", () => {
  const script = installImageProjectScript("/staging/it's-a-project", true)

  assert.match(script, /MooseNexusProjectDirectoryInstaller new/)
  assert.match(script, /repository := MooseNexusRepository default/)
  assert.match(script, /installer installProjectDirectory: '\/staging\/it''s-a-project' asFileReference in: repository force: true/)
  assert.match(script, /Smalltalk snapshot: false andQuit: true/)
})

test("rebases a pulled image model from its selected repository", () => {
  const script = rebaseImageModelScript({ group: "com.example", name: "demo", version: "1.0.0" }, "demo-model", "/images/example/pharo-local/MooseNexus")

  assert.match(script, /project := repository group: 'com.example' project: 'demo' version: '1.0.0'/)
  assert.match(script, /project rebaseLoadedModelNamed: 'demo-model'/)
  assert.match(script, /Smalltalk snapshot: true andQuit: true/)
})
