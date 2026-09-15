import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { listArtifacts, projectCoordinate, renderArtifacts } from "../src/artifacts.js"

test("lists model and image artifacts without a Pharo runtime", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "moosenexus-artifacts-test-"))
  await writeProjectArtifacts(homeDirectory, "com.example", "demo", "1.0.0", "java", "MooseNexusMavenProject")
  await writeProjectArtifacts(homeDirectory, "com.example", "api", "2.0.0", "typescript", "MooseNexusNpmProject")

  const projects = await listArtifacts(homeDirectory)

  assert.deepEqual(projects.map(projectCoordinate), ["com.example:api:2.0.0", "com.example:demo:1.0.0"])
  assert.deepEqual(projects[0]!.models[0], {
    name: "api-model",
    classifier: "main",
    format: "json",
    metamodel: "FamixJava",
    description: "API description",
    createdTimestamp: "2026-09-15T10:00:00+02:00"
  })
  assert.deepEqual(projects[1]!.images, [{ name: "demo-image", modelName: "demo-model" }])
})

test("lists no artifacts from a missing repository", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "moosenexus-artifacts-test-"))

  assert.deepEqual(await listArtifacts(homeDirectory), [])
})

test("renders artifacts grouped by their source project", () => {
  const output = renderArtifacts([
    {
      coordinates: { group: "com.example", name: "demo", version: "1.0.0" },
      language: "java",
      nature: "MooseNexusMavenProject",
      models: [{
        name: "demo-model",
        classifier: "main",
        format: "json",
        metamodel: "FamixJava",
        description: "Demo analysis",
        createdTimestamp: "2026-09-15T10:00:00+02:00"
      }],
      images: [{ name: "demo-image", modelName: "demo-model" }]
    }
  ])

  assert.equal(
    output,
    [
      "com.example:demo:1.0.0  Maven, java",
      "  model demo-model [main, json, FamixJava] \"Demo analysis\"",
      "  image demo-image [model: demo-model]"
    ].join("\n")
  )
})

const writeProjectArtifacts = async (
  homeDirectory: string,
  group: string,
  name: string,
  version: string,
  language: string,
  nature: string
): Promise<void> => {
  const metadataDirectory = join(homeDirectory, "repository", group, name, version, "metadata")
  await mkdir(metadataDirectory, { recursive: true })
  await writeFile(
    join(metadataDirectory, "properties.json"),
    JSON.stringify({ schemaVersion: "1", group, name, version, language, nature })
  )
  await writeFile(
    join(metadataDirectory, "models.json"),
    JSON.stringify([{
      createdTimestamp: "2026-09-15T10:00:00+02:00",
      modelArtifact: {
        comment: `${name === "api" ? "API" : "Demo"} description`,
        artifactCoordinates: {
          name: `${name}-model`,
          classifier: "main",
          format: "json",
          metamodel: "FamixJava"
        }
      }
    }])
  )
  await writeFile(
    join(metadataDirectory, "images.json"),
    JSON.stringify(name === "demo" ? [{ name: "demo-image", modelArtifact: "demo-model" }] : [])
  )
}
