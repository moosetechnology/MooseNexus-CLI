import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { mooseNexusHomeDirectory } from "./runtime.js"

export interface StoredProjectArtifacts {
  readonly coordinates: {
    readonly group: string
    readonly name: string
    readonly version: string
  }
  readonly language: string
  readonly nature: string
  readonly models: ReadonlyArray<StoredModelArtifact>
  readonly images: ReadonlyArray<StoredImageArtifact>
}

export interface StoredModelArtifact {
  readonly name: string
  readonly classifier: string
  readonly format: string
  readonly metamodel: string
  readonly description: string
  readonly createdTimestamp: string
}

export interface StoredImageArtifact {
  readonly name: string
  readonly modelName: string
}

export const listArtifacts = async (
  homeDirectory = mooseNexusHomeDirectory()
): Promise<ReadonlyArray<StoredProjectArtifacts>> => {
  const projectDirectories = await nestedDirectories(join(homeDirectory, "repository"), 3)
  const projects = await Promise.all(projectDirectories.map(readProjectArtifacts))

  return projects.sort((left, right) => projectCoordinate(left).localeCompare(projectCoordinate(right)))
}

export const projectCoordinate = (project: StoredProjectArtifacts): string => {
  const { group, name, version } = project.coordinates
  return `${group}:${name}:${version}`
}

export const renderArtifacts = (projects: ReadonlyArray<StoredProjectArtifacts>): string => {
  if (projects.length === 0) return "No MooseNexus artifacts are installed."

  return projects.flatMap((project) => [
    `${projectCoordinate(project)}  ${projectNatureLabel(project.nature)}, ${project.language}`,
    ...project.models.map(renderModelArtifact),
    ...project.images.map(renderImageArtifact)
  ]).join("\n")
}

export const projectNatureLabel = (nature: string): string => {
  const knownLabels: Readonly<Record<string, string>> = {
    MooseNexusGradleProject: "Gradle",
    MooseNexusMavenProject: "Maven",
    MooseNexusNpmProject: "npm",
    MooseNexusUnmanagedProject: "Unmanaged"
  }

  const knownLabel = knownLabels[nature]
  if (knownLabel !== undefined) return knownLabel

  return nature
    .replace(/^MooseNexus/, "")
    .replace(/Project$/, "")
}

const renderModelArtifact = (artifact: StoredModelArtifact): string => {
  const description = artifact.description === "" ? "" : ` ${JSON.stringify(artifact.description)}`
  return `  model ${artifact.name} [${artifact.classifier}, ${artifact.format}, ${artifact.metamodel}]${description}`
}

const renderImageArtifact = (artifact: StoredImageArtifact): string =>
  `  image ${artifact.name} [model: ${artifact.modelName}]`

const nestedDirectories = async (directory: string, depth: number): Promise<Array<string>> => {
  const entries = await directoryEntries(directory)
  if (depth === 1) return entries

  return (await Promise.all(entries.map((entry) => nestedDirectories(entry, depth - 1)))).flat()
}

const directoryEntries = async (directory: string): Promise<Array<string>> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name))
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
}

const readProjectArtifacts = async (directory: string): Promise<StoredProjectArtifacts> => {
  const metadataDirectory = join(directory, "metadata")
  const propertiesPath = join(metadataDirectory, "properties.json")
  const properties = await readJson(propertiesPath)

  return {
    coordinates: {
      group: requiredString(properties, "group", propertiesPath),
      name: requiredString(properties, "name", propertiesPath),
      version: requiredString(properties, "version", propertiesPath)
    },
    language: requiredString(properties, "language", propertiesPath),
    nature: requiredString(properties, "nature", propertiesPath),
    models: await readModelArtifacts(join(metadataDirectory, "models.json")),
    images: await readImageArtifacts(join(metadataDirectory, "images.json"))
  }
}

const readModelArtifacts = async (path: string): Promise<ReadonlyArray<StoredModelArtifact>> => {
  const manifests = await readJsonArray(path)

  return manifests.map((manifest, index) => {
    const manifestPath = `${path}[${index}]`
    const modelArtifact = requiredRecord(manifest, "modelArtifact", manifestPath)
    const artifactCoordinates = requiredRecord(modelArtifact, "artifactCoordinates", manifestPath)

    return {
      name: requiredString(artifactCoordinates, "name", manifestPath),
      classifier: requiredString(artifactCoordinates, "classifier", manifestPath),
      format: requiredString(artifactCoordinates, "format", manifestPath),
      metamodel: requiredString(artifactCoordinates, "metamodel", manifestPath),
      description: requiredString(modelArtifact, "comment", manifestPath),
      createdTimestamp: requiredString(manifest, "createdTimestamp", manifestPath)
    }
  })
}

const readImageArtifacts = async (path: string): Promise<ReadonlyArray<StoredImageArtifact>> => {
  const artifacts = await readJsonArray(path, true)

  return artifacts.map((artifact, index) => {
    const artifactPath = `${path}[${index}]`
    return {
      name: requiredString(artifact, "name", artifactPath),
      modelName: requiredString(artifact, "modelArtifact", artifactPath)
    }
  })
}

const readJson = async (path: string): Promise<Record<string, unknown>> => {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid MooseNexus metadata: ${path}`)
  }
  return parsed as Record<string, unknown>
}

const readJsonArray = async (path: string, optional = false): Promise<ReadonlyArray<Record<string, unknown>>> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "object" || entry === null || Array.isArray(entry))) {
      throw new Error(`Invalid MooseNexus metadata: ${path}`)
    }
    return parsed as Array<Record<string, unknown>>
  } catch (error) {
    if (optional && isMissingFile(error)) return []
    throw error
  }
}

const requiredRecord = (record: Record<string, unknown>, key: string, path: string): Record<string, unknown> => {
  const value = record[key]
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid MooseNexus metadata: ${path}.${key}`)
  }
  return value as Record<string, unknown>
}

const requiredString = (record: Record<string, unknown>, key: string, path: string): string => {
  const value = record[key]
  if (typeof value !== "string") throw new Error(`Invalid MooseNexus metadata: ${path}.${key}`)
  return value
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
