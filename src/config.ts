import * as Schema from "effect/Schema"

export const PharoConfig = Schema.Struct({
  version: Schema.optionalWith(Schema.String, { default: () => "latest" }),
  vmUrl: Schema.optional(Schema.String)
})

export const MooseConfig = Schema.Struct({
  version: Schema.optionalWith(Schema.String, { default: () => "latest" }),
  imageUrl: Schema.optional(Schema.String)
})

export const MooseNexusConfig = Schema.Struct({
  repository: Schema.optionalWith(Schema.String, { default: () => "github://moosetechnology/MooseNexus" }),
  version: Schema.optionalWith(Schema.String, { default: () => "1.1.x" }),
  revision: Schema.optional(Schema.String),
  resolvedRevision: Schema.optional(Schema.String),
  baseline: Schema.optionalWith(Schema.String, { default: () => "MooseNexus" })
})

export const CoordinatesConfig = Schema.Struct({
  group: Schema.String,
  name: Schema.String,
  version: Schema.String
})

export const VerveineJConfig = Schema.Struct({
  runner: Schema.Literal("local", "docker"),
  directory: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  format: Schema.optional(Schema.Literal("json", "mse")),
  allLocals: Schema.optional(Schema.Boolean),
  anchor: Schema.optional(Schema.Literal("none", "entity", "default", "assoc")),
  excludePaths: Schema.optional(Schema.Array(Schema.String)),
  javaVersion: Schema.optional(Schema.String),
  jvmArgs: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.Boolean)
})

export const defaultTs2FamixConfig = {
  repository: "https://github.com/fuhrmanator/FamixTypeScriptImporter.git",
  revision: "679f54e7a0990791e8dce3e437ff4915baebfdc5"
} as const

export const Ts2FamixConfig = Schema.Struct({
  repository: Schema.optionalWith(Schema.String, { default: () => defaultTs2FamixConfig.repository }),
  revision: Schema.optionalWith(Schema.String, { default: () => defaultTs2FamixConfig.revision })
})

export const BuildSpecConfig = Schema.Struct({
  file: Schema.optional(Schema.String),
  coordinates: Schema.optional(CoordinatesConfig),
  sourceDirectory: Schema.optional(Schema.String),
  projectKind: Schema.optionalWith(Schema.Literal("auto", "managed", "unmanaged"), { default: () => "auto" }),
  language: Schema.optional(Schema.String),
  dependencyDirectory: Schema.optional(Schema.String),
  modelName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  verveineJ: Schema.optional(VerveineJConfig),
  ts2famix: Schema.optional(Ts2FamixConfig)
})

export const ArtifactConfig = Schema.Struct({
  format: Schema.optionalWith(Schema.Literal("zip"), { default: () => "zip" }),
  outputDirectory: Schema.optional(Schema.String)
})

const defaultArtifactConfig: Schema.Schema.Type<typeof ArtifactConfig> = {
  format: "zip"
}

export const OciConfig = Schema.Struct({
  registry: Schema.String,
  namespace: Schema.String
})

export const CliConfig = Schema.Struct({
  pharo: Schema.optionalWith(PharoConfig, { default: () => ({ version: "latest" }) }),
  moose: Schema.optionalWith(MooseConfig, { default: () => ({ version: "latest" }) }),
  moosenexus: Schema.optionalWith(MooseNexusConfig, {
    default: () => ({ repository: "github://moosetechnology/MooseNexus", version: "1.1.x", baseline: "MooseNexus" })
  }),
  buildSpec: Schema.optionalWith(BuildSpecConfig, { default: () => ({ projectKind: "auto" }) }),
  artifact: Schema.optionalWith(ArtifactConfig, { default: () => defaultArtifactConfig }),
  oci: Schema.optional(OciConfig)
})

export type CliConfig = Schema.Schema.Type<typeof CliConfig>

export const defaultCliConfig: CliConfig = {
  pharo: {
    version: "latest"
  },
  moose: {
    version: "latest"
  },
  moosenexus: {
    repository: "github://moosetechnology/MooseNexus",
    version: "1.1.x",
    baseline: "MooseNexus"
  },
  buildSpec: {
    projectKind: "auto"
  },
  artifact: defaultArtifactConfig
}
