import type { CliConfig } from "./config.js"

export const loadMooseNexusScript = (config: CliConfig): string =>
  [
    "Metacello new",
    `\trepository: '${smalltalkString(metacelloRepository(config))}';`,
    `\tbaseline: '${smalltalkString(config.moosenexus.baseline)}';`,
    "\tload.",
    ...(config.buildSpec.language === "typescript" ? [
      "Metacello new",
      `\trepository: '${smalltalkString(metacelloRepository(config))}';`,
      `\tbaseline: '${smalltalkString(config.moosenexus.baseline)}';`,
      "\tload: 'TypeScript'."
    ] : []),
    "Smalltalk snapshot: true andQuit: true"
  ].join("\n") + "\n"

export const inlineBuildScript = (config: CliConfig, resultFile: string | undefined, typeScriptRunnerCommand?: string): string => {
  const [declarations, ...lines] = inlineBuildSetup(config, "| coordinates extractor importer spec repository result headlessResult |", typeScriptRunnerCommand)
  lines.push(
    "result := spec executeIn: repository.",
    "result project importModel: result modelArtifact."
  )
  return headlessOperationScript(declarations!, "build-image", "execute-spec", resultFile, headlessContextFor(config), lines, true)
}

export const inlineModelBuildScript = (config: CliConfig, resultFile: string | undefined, typeScriptRunnerCommand?: string): string => {
  const [declarations, ...lines] = inlineBuildSetup(config, "| coordinates extractor importer spec repository result headlessResult |", typeScriptRunnerCommand)
  lines.push(
    "result := spec executeIn: repository."
  )
  return headlessOperationScript(declarations!, "build-model", "execute-spec", resultFile, headlessContextFor(config), lines, false)
}

export const externalBuildScript = (config: CliConfig, specSource: string, resultFile: string | undefined, typeScriptRunnerCommand?: string): string => {
  const [declarations, ...lines] = externalBuildSetup(specSource, "| repository spec result headlessResult |", typeScriptRunnerCommand)
  lines.push(
    "result := spec executeIn: repository.",
    "result project importModel: result modelArtifact."
  )
  return headlessOperationScript(declarations!, "build-image", "execute-spec", resultFile, headlessContextFor(config), lines, true)
}

export const externalModelBuildScript = (config: CliConfig, specSource: string, resultFile: string | undefined, typeScriptRunnerCommand?: string): string => {
  const [declarations, ...lines] = externalBuildSetup(specSource, "| repository spec result headlessResult |", typeScriptRunnerCommand)
  lines.push("result := spec executeIn: repository.")
  return headlessOperationScript(declarations!, "build-model", "execute-spec", resultFile, headlessContextFor(config), lines, false)
}

export const publishModelScript = (config: CliConfig, resultFile: string | undefined, repositoryDirectory?: string): string => {
  if (config.oci === undefined) {
    throw new Error("Publishing a model requires OCI settings.")
  }

  return headlessOperationScript(
    "| repository project manifest mapper publisher headlessResult |",
    "publish-model",
    "publish",
    resultFile,
    headlessContextFor(config),
    [
      repositoryDirectory === undefined
        ? "repository := MooseNexusRepository imageLocal."
        : repositoryStatement(repositoryDirectory),
      "repository projects size = 1 ifFalse: [ Error signal: 'A build spec must record exactly one project to publish a model artifact' ].",
      "project := repository projects first.",
      "project modelManifests size = 1 ifFalse: [ Error signal: 'A build spec must produce exactly one model artifact to publish it' ].",
      "manifest := project modelManifests first.",
      "mapper := MooseNexusOciReferenceMapper",
      `\tregistry: '${smalltalkString(config.oci.registry)}'`,
      `\tnamespace: '${smalltalkString(config.oci.namespace)}'.`,
      "publisher := MooseNexusOciArtifactPublisher",
      "\treferenceMapper: mapper",
      "\ttransport: MooseNexusOrasTransport new.",
      "publisher publishManifest: manifest of: project."
    ],
    false
  )
}

export const publishStoredModelScript = (
  config: CliConfig,
  resultFile: string | undefined,
  repositoryDirectory: string
): string => {
  if (config.oci === undefined || config.buildSpec.coordinates === undefined) {
    throw new Error("Publishing an installed model requires OCI settings and project coordinates.")
  }

  const coordinates = config.buildSpec.coordinates
  return headlessOperationScript(
    "| repository project manifest mapper publisher headlessResult |",
    "publish-model",
    "publish",
    resultFile,
    headlessContextForCoordinates(coordinates),
    [
      repositoryStatement(repositoryDirectory),
      `project := repository group: '${smalltalkString(coordinates.group)}' project: '${smalltalkString(coordinates.name)}' version: '${smalltalkString(coordinates.version)}'.`,
      "project modelManifests size = 1 ifFalse: [ Error signal: 'An installed project must have exactly one model artifact to publish it' ].",
      "manifest := project modelManifests first.",
      "mapper := MooseNexusOciReferenceMapper",
      `\tregistry: '${smalltalkString(config.oci.registry)}'`,
      `\tnamespace: '${smalltalkString(config.oci.namespace)}'.`,
      "publisher := MooseNexusOciArtifactPublisher",
      "\treferenceMapper: mapper",
      "\ttransport: MooseNexusOrasTransport new.",
      "publisher publishManifest: manifest of: project."
    ],
    false
  )
}

export const installModelBundleScript = (
  bundleDirectory: string,
  force: boolean,
  resultFile: string | undefined,
  repositoryDirectory?: string
): string =>
  headlessOperationScript(
    "| installer repository headlessResult |",
    "install-model",
    "install",
    resultFile,
    headlessRepositoryContext(repositoryDirectory),
    [
      "installer := MooseNexusOciArtifactInstaller new.",
      repositoryStatement(repositoryDirectory),
      force
        ? `installer installBundleFrom: '${smalltalkString(bundleDirectory)}' asFileReference in: repository force: true.`
        : `installer installBundleFrom: '${smalltalkString(bundleDirectory)}' asFileReference in: repository.`,
    ],
    false
  )

export const installImageProjectScript = (
  projectDirectory: string,
  force: boolean,
  resultFile: string | undefined,
  repositoryDirectory?: string
): string =>
  headlessOperationScript(
    "| installer repository headlessResult |",
    "install-project",
    "install",
    resultFile,
    headlessRepositoryContext(repositoryDirectory),
    [
      "installer := MooseNexusProjectDirectoryInstaller new.",
      repositoryStatement(repositoryDirectory),
      installProjectStatement(projectDirectory, force),
    ],
    false
  )

export const rebaseImageModelScript = (
  coordinates: { readonly group: string; readonly name: string; readonly version: string },
  modelName: string,
  resultFile: string | undefined,
  repositoryDirectory?: string
): string =>
  headlessOperationScript(
    "| repository project headlessResult |",
    "rebase-image-model",
    "rebase",
    resultFile,
    headlessContextForCoordinates(coordinates),
    [
      repositoryStatement(repositoryDirectory),
      rebaseProjectStatement(coordinates, modelName)
    ],
    true
  )

const repositoryStatement = (repositoryDirectory: string | undefined): string =>
  repositoryDirectory === undefined
    ? "repository := MooseNexusRepository default."
    : `repository := MooseNexusRepository new directory: '${smalltalkString(repositoryDirectory)}' asFileReference.`

const installProjectStatement = (projectDirectory: string, force: boolean): string =>
  force
    ? `installer installProjectDirectory: '${smalltalkString(projectDirectory)}' asFileReference in: repository force: true.`
    : `installer installProjectDirectory: '${smalltalkString(projectDirectory)}' asFileReference in: repository.`

const rebaseProjectStatement = (
  coordinates: { readonly group: string; readonly name: string; readonly version: string },
  modelName: string
): string =>
  [
    `project := repository group: '${smalltalkString(coordinates.group)}' project: '${smalltalkString(coordinates.name)}' version: '${smalltalkString(coordinates.version)}'.`,
    `project rebaseLoadedModelNamed: '${smalltalkString(modelName)}'.`,
  ].join("\n")

const inlineBuildSetup = (
  config: CliConfig,
  declarations: string,
  typeScriptRunnerCommand: string | undefined
): Array<string> => {
  const buildSpec = config.buildSpec
  const coordinates = buildSpec.coordinates

  if (coordinates === undefined || buildSpec.sourceDirectory === undefined) {
    throw new Error("Cannot materialize an inline build spec without coordinates and a source directory.")
  }

  const lines = [
    declarations,
    "coordinates := MooseNexusCoordinates",
    `\tgroup: '${smalltalkString(coordinates.group)}'`,
    `\tname: '${smalltalkString(coordinates.name)}'`,
    `\tversion: '${smalltalkString(coordinates.version)}'.`,
    "repository := MooseNexusRepository imageLocal.",
    "spec := MooseNexusBuildSpec",
    "\tcoordinates: coordinates",
    `\tsourceDirectory: '${smalltalkString(buildSpec.sourceDirectory)}' asFileReference.`,
  ]

  if (buildSpec.projectKind === "unmanaged") {
    if (buildSpec.language === undefined) {
      throw new Error("An unmanaged project requires a language.")
    }

    lines.push(
      "importer := MooseNexusUnmanagedProjectImporter new",
      `\tlanguage: '${smalltalkString(buildSpec.language)}';`,
      ...(buildSpec.dependencyDirectory === undefined ? [] : [`\tdependencyDirectory: '${smalltalkString(buildSpec.dependencyDirectory)}';`]),
      "\tdependencies: #( ).",
      "spec projectImporter: importer."
    )
  }

  if (buildSpec.modelName !== undefined) {
    lines.push(`spec modelName: '${smalltalkString(buildSpec.modelName)}'.`)
  }

  if (buildSpec.description !== undefined) {
    lines.push(`spec modelComment: '${smalltalkString(buildSpec.description)}'.`)
  }

  if (buildSpec.verveineJ !== undefined) {
    lines.push(
      `extractor := ${verveineJRunnerClassFor(buildSpec.verveineJ.runner)} new.`,
      ...verveineJConfigurationLines(buildSpec.verveineJ),
      "spec extractor: extractor."
    )
  }

  lines.push(...typeScriptRunnerConfigurationLines(config, typeScriptRunnerCommand))

  return lines
}

const externalBuildSetup = (
  specSource: string,
  declarations: string,
  typeScriptRunnerCommand: string | undefined
): Array<string> => [
  declarations,
  "repository := MooseNexusRepository imageLocal.",
  "spec := [",
  specSource,
  "] value.",
  "(spec isKindOf: MooseNexusBuildSpec) ifFalse: [ Error signal: 'A MooseNexus CLI spec must evaluate to a MooseNexusBuildSpec' ].",
  ...(typeScriptRunnerCommand === undefined ? [] : typeScriptRunnerConfigurationLinesForCommand(typeScriptRunnerCommand))
]

export const metacelloRepository = (config: CliConfig): string => {
  const repository = config.moosenexus.repository
  if (!/^github:\/\/[^/:]+\/[^/:]+$/.test(repository)) {
    return repository
  }

  const revision = config.moosenexus.revision ?? `v${config.moosenexus.version}`
  return `${repository}:${revision}/src`
}

export const smalltalkString = (value: string): string => value.replaceAll("'", "''")

const headlessOperationScript = (
  declarations: string,
  operation: string,
  phase: string,
  resultFile: string | undefined,
  context: string,
  statements: ReadonlyArray<string>,
  saveImage: boolean
): string =>
  resultFile === undefined
    ? [
      declarations,
      ...statements,
      `Smalltalk snapshot: ${saveImage} andQuit: true`
    ].join("\n") + "\n"
    : [
    declarations,
    "headlessResult := MooseNexusHeadlessResult",
    `\texecute: '${smalltalkString(operation)}'`,
    `\tphase: '${smalltalkString(phase)}'`,
    `\tcontext: ${context}`,
    "\tdo: [",
    ...statements.flatMap((statement) => statement.split("\n").map((line) => `\t\t${line}`)),
    "\t].",
    `headlessResult writeTo: '${smalltalkString(resultFile)}' asFileReference.`,
    "headlessResult isSuccess ifFalse: [ Smalltalk snapshot: false andQuit: true ].",
    `Smalltalk snapshot: ${saveImage} andQuit: true`
    ].join("\n") + "\n"

const headlessContextFor = (config: CliConfig): string =>
  config.buildSpec.coordinates === undefined
    ? "Dictionary new"
    : headlessContextForCoordinates(config.buildSpec.coordinates)

const headlessContextForCoordinates = (
  coordinates: { readonly group: string; readonly name: string; readonly version: string }
): string =>
  `(Dictionary new add: 'project' -> '${smalltalkString(`${coordinates.group}:${coordinates.name}:${coordinates.version}`)}'; yourself)`

const headlessRepositoryContext = (repositoryDirectory: string | undefined): string =>
  repositoryDirectory === undefined
    ? "Dictionary new"
    : `(Dictionary new add: 'repository' -> '${smalltalkString(repositoryDirectory)}'; yourself)`

const verveineJRunnerClassFor = (kind: "local" | "docker"): string =>
  kind === "local" ? "MooseNexusLocalVerveineJRunner" : "MooseNexusDockerVerveineJRunner"

const verveineJConfigurationLines = (extractor: NonNullable<CliConfig["buildSpec"]["verveineJ"]>): Array<string> =>
  [
    ...(extractor.runner === "local" ? [`extractor directory: '${smalltalkString(extractor.directory!)}'.`] : []),
    ...(extractor.version === undefined ? [] : [`extractor version: '${smalltalkString(extractor.version)}'.`]),
    ...(extractor.format === undefined ? [] : [`extractor format: #${extractor.format}.`]),
    ...(extractor.allLocals === undefined ? [] : [`extractor allLocals: ${extractor.allLocals}.`]),
    ...(extractor.anchor === undefined ? [] : [`extractor anchor: #${extractor.anchor}.`]),
    ...(extractor.excludePaths === undefined ? [] : [`extractor excludePaths: ${smalltalkStringArray(extractor.excludePaths)}.`]),
    ...(extractor.javaVersion === undefined ? [] : [`extractor javaVersion: '${smalltalkString(extractor.javaVersion)}'.`]),
    ...(extractor.jvmArgs === undefined ? [] : [`extractor jvmArgs: '${smalltalkString(extractor.jvmArgs)}'.`]),
    ...(extractor.summary === undefined ? [] : [`extractor summary: ${extractor.summary}.`])
  ]

const typeScriptRunnerConfigurationLines = (config: CliConfig, command: string | undefined): Array<string> =>
  config.buildSpec.language === "typescript"
    ? typeScriptRunnerConfigurationLinesForCommand(command)
    : []

const typeScriptRunnerConfigurationLinesForCommand = (command: string | undefined): Array<string> => {
  if (command === undefined) throw new Error("A TypeScript build requires a provisioned ts2famix command.")

  return [
    "spec language: 'typescript'.",
    "extractor := MooseNexusLocalTypeScriptRunner new.",
    `extractor command: '${smalltalkString(command)}'.`,
    "spec extractor: extractor."
  ]
}

const smalltalkStringArray = (values: ReadonlyArray<string>): string =>
  `#(${values.map((value) => `'${smalltalkString(value)}'`).join(" ")})`
