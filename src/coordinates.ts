export interface ProjectCoordinates {
  readonly group: string
  readonly name: string
  readonly version: string
}

interface ProjectCoordinateOverrides {
  readonly group: string | undefined
  readonly name: string | undefined
  readonly version: string | undefined
}

export const parseProjectCoordinates = (value: string): ProjectCoordinates => {
  const parts = value.split(":")
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid project coordinates: ${value}. Expected <group>:<name>:<version>.`)
  }

  const [group, name, version] = parts
  return { group: group!, name: name!, version: version! }
}

export const resolveProjectCoordinates = (
  compact: string | undefined,
  explicit: ProjectCoordinateOverrides,
  fallback: ProjectCoordinates | undefined
): ProjectCoordinates | undefined => {
  if (compact !== undefined) {
    if (explicit.group !== undefined || explicit.name !== undefined || explicit.version !== undefined) {
      throw new Error("Use either <group>:<name>:<version> or --project-group, --project-name, and --project-version.")
    }
    return parseProjectCoordinates(compact)
  }

  const group = explicit.group ?? fallback?.group
  const name = explicit.name ?? fallback?.name
  const version = explicit.version ?? fallback?.version
  if (group === undefined && name === undefined && version === undefined) return fallback

  return { group: group ?? "", name: name ?? "", version: version ?? "" }
}
