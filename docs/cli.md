# CLI Configuration

## Commands

`build-image` creates a Moose image artifact and installs it in the local MooseNexus repository. `--out` additionally retains a portable ZIP, and OCI publication is optional.

`build-model` creates and installs a Moose model artifact. `--out` additionally retains the portable project directory, and OCI publication is optional.

`pull-image` retrieves an OCI image artifact. Without `--out`, it installs the project in the default user repository at `$MOOSENEXUS_HOME/repository/`, where `MOOSENEXUS_HOME` defaults to `~/.moose`. With `--out`, it installs an image-scoped repository below that directory. Installed artifacts are repository-owned copies; use `--adopt`, `--adopt-as`, or `--adopt-to` to also create a mutable Pharo image copy.

`pull-model` retrieves an OCI model artifact and installs it in `$MOOSENEXUS_HOME/repository/`.

`adopt-image` copies an installed image artifact into a new Pharo image folder. The default location is `~/Documents/Pharo/images/`. It copies the `.image`, `.changes`, sources file, and launcher metadata, updating the launcher metadata when the copy is renamed.

`artifacts` lists installed model and image artifacts grouped by their source-project coordinates. Model entries include their description; image entries refer to the model they contain. Pass `--json` for scripts and CI.

`doctor` reports the availability and version output of local tools used by MooseNexus workflows. It does not fail when an optional capability is unavailable: the report explains which workflow needs it.

Every command that operates on a project accepts its coordinates as `<group>:<name>:<version>`. The expanded `--project-group`, `--project-name`, and `--project-version` options remain available for scripts and configuration, but cannot be combined with the compact form.

An adoption destination must not already exist. The CLI never replaces an adopted image. `--adopt-as <name>` and `--adopt-to <directory>` each imply adoption; `--adopt` is the shortcut for the model name in the default destination. For `pull-image`, `--out` creates a one-off image-scoped installation and cannot be combined with adoption.

```sh
moosenexus pull-image <pull options> --adopt-as backend-analysis

moosenexus adopt-image com.example:backend:1.2.3

moosenexus adopt-image \
  --project-group com.example \
  --project-name backend \
  --project-version 1.0.0 \
  --adopt-to ~/Documents/Pharo/images

moosenexus artifacts --json

moosenexus doctor
```

Use `moosenexus --wizard` for an interactive command builder. `--wizard --expert` additionally exposes bootstrap URLs and MooseNexus source settings.

## Machine-readable Results

Pass `--json` to build, pull, adoption, and diagnostic commands to write one versioned result object to standard output. Workflow progress remains on standard error, allowing scripts to consume standard output directly. A dry run returns a versioned plan object instead of a completed result. Errors remain concise standard-error diagnostics.

## Build Input

The CLI has two distinct input formats:

- A **configuration** is a YAML file loaded with `--config`. It configures the CLI itself: the Moose runtime, the MooseNexus release, artifact output, OCI destination, and either a build spec file or inline build inputs.
- A **build spec** is a Smalltalk file loaded with `--spec`. It must evaluate to a `MooseNexusBuildSpec`. The CLI evaluates it in its fresh, isolated MooseNexus repository, executes the returned spec, and uses the result to build or publish the artifact.

For either `build-image` or `build-model`, provide `--spec <file>` or a compact coordinate followed by a source directory:

```text
<group>:<name>:<version>
<source-directory>
```

Use `--source` and all three `--project-*` options instead of positional inputs when needed.

`--config <file>` loads a YAML configuration. CLI options override values from that file. Inline extractor options follow `--`, so the CLI can delegate them to the selected extractor. Leaving `artifact.outputDirectory` unset installs only into the local repository.

```sh
moosenexus build-image \
  --config build.yml \
  --project-version 1.1.0 \
  -- --runner docker --version v4.1.4 -anchor assoc
```

The [`examples/`](../examples/) directory provides two starting points:

- [`unmanaged-java.yml`](../examples/unmanaged-java.yml) is a YAML configuration with inline inputs for an unmanaged Java project.
- [`external-build-spec.yml`](../examples/external-build-spec.yml) loads [`unmanaged-java.st`](../examples/unmanaged-java.st), which owns the build inputs in Smalltalk and publishes a model through the configured OCI registry.
- [`typescript-npm.yml`](../examples/typescript-npm.yml) is a YAML configuration for an npm-managed TypeScript project.

The supported YAML shape is:

```yaml
pharo:
  version: "latest"
  vmUrl: "https://example.com/vm" # optional; inferred when omitted

moose:
  version: "latest"
  imageUrl: "https://example.com/moose.zip" # optional; inferred when omitted

moosenexus:
  repository: "github://moosetechnology/MooseNexus" # optional
  version: "1.x.x" # optional; newest compatible MooseNexus v1 release
  baseline: "MooseNexus" # optional

buildSpec:
  file: "./build-spec.st" # optional; use instead of inline build input
  coordinates:
    group: "com.example"
    name: "demo"
    version: "1.0.0"
  sourceDirectory: "/path/to/source/project"
  projectKind: "unmanaged" # auto, managed, or unmanaged
  language: "java"
  dependencyDirectory: "/path/to/local-jars" # Unmanaged projects only; optional
  modelName: "demo-model" # optional; defaults to the project name
  description: "Demo model artifact" # optional
  verveineJ:
    runner: "docker" # docker or local
    directory: "/path/to/VerveineJ" # required for runner local
    version: "v4.1.4" # Docker image tag
    format: "json" # json or mse
    allLocals: true
    anchor: "assoc" # none, entity, default, or assoc
    excludePaths:
      - "**/generated/**"
    javaVersion: "17"
    jvmArgs: "-Xmx4g"
    summary: true
  ts2famix:
    repository: "https://github.com/fuhrmanator/FamixTypeScriptImporter.git" # TypeScript only; optional
    revision: "679f54e7a0990791e8dce3e437ff4915baebfdc5" # TypeScript only; optional

artifact:
  format: "zip"
  outputDirectory: "./artifacts"

oci:
  registry: "registry.example.com"
  namespace: "moose"
```

The default Moose version is `latest`. The CLI resolves the latest Moose release, selects the newest Pharo image provided by that release, and records both resolved versions before creating a runtime cache entry. Pin `--moose` and `--pharo` when a build must use specific versions. `--moose 12` and `--moose 12.3` are completed to `12.0.0` and `12.3.0`. MooseNexus defaults to `github://moosetechnology/MooseNexus` at the floating `v1.x.x` tag, which follows compatible v1 releases without accepting a future major release. Project kind defaults to `auto`, results install into the local repository, and artifact format to ZIP.

New build workflows require MooseNexus 1.1.0 or later. Those releases provide the structured result contract that lets the CLI report operation failures without parsing Pharo stack traces. The CLI validates this requirement before it starts a build. Older image and model artifacts remain readable through the legacy pull path.

`dependencyDirectory` and `--dependency-directory` configure an unmanaged project with a directory of local JARs. They require `projectKind: unmanaged` or `--kind unmanaged`, and MooseNexus `1.0.0` or later.

An external build spec is an expression whose final value is a `MooseNexusBuildSpec`, for example:

```smalltalk
| coordinates |
coordinates := MooseNexusCoordinates
  group: 'com.example'
  name: 'demo'
  version: '1.0.0'.

MooseNexusBuildSpec
  coordinates: coordinates
  sourceDirectory: '/path/to/source/project' asFileReference
```

The spec owns its project coordinates, source directory, importer, model name, and extractor configuration. It must produce exactly one project and model artifact when used with `build-model`; this lets the CLI publish that result without restating its coordinates. Therefore `build-model --spec` rejects `--project-group`, `--project-name`, and `--project-version`. An image built from an external spec can be retained locally without CLI coordinates, but OCI image publication still requires coordinates so the CLI can form the image reference before publishing. For a TypeScript workflow, `--language typescript` additionally lets the CLI attach its workspace-local ts2famix runner after the spec is evaluated.

Source paths beginning with `~/` are expanded to the current user's home directory. `--dry-run` prints the resolved build workflow without creating a workspace. `--keep` retains a completed build workspace for diagnosis and cannot be combined with `--dry-run`. `--out` retains a portable export in addition to installation: a ZIP for `build-image`, or the recorded project directory for `build-model`. `--no-install` creates no durable local project and requires either `--out` or OCI publication.

## Extraction

Java is supported by the CLI. TypeScript support is experimental and its end-to-end CI remains deferred while the upstream TypeScript projects remain pre-release. Extractor options must follow the `--` separator and belong to the language selected by `--language`:

```sh
moosenexus build-model <build options> -- \
  --runner docker \
  --version v4.1.4 \
  -format json \
  -alllocals \
  -anchor assoc \
  -excludepath '**/generated/**' \
  -17 \
  --jvm-args '-Xmx4g' \
  -summary
```

`--runner docker` is the default. `--runner local` requires `--directory <VerveineJ checkout>`. `--version` applies only to Docker. Omitting `-format`, `-anchor`, and the Java source-level flag retains VerveineJ's defaults.

### Experimental TypeScript / ts2famix

TypeScript projects require Moose 13 or later and an npm `package-lock.json` in format 2 or 3. Set `--language typescript` to load MooseNexus's optional TypeScript and FamixTypeScript packages and to select the npm importer when a source directory has multiple recognizable project natures.

The CLI clones the pinned ts2famix source into its temporary workspace, checks out its configured revision, runs `npm ci --ignore-scripts`, then builds it locally. It configures `MooseNexusLocalTypeScriptRunner` with that workspace-local command. Neither ts2famix nor its dependencies are installed globally, and the analyzed project is not modified.

The default source is `https://github.com/fuhrmanator/FamixTypeScriptImporter.git` at commit `679f54e7a0990791e8dce3e437ff4915baebfdc5`. Override either value after the separator when intentionally testing another revision:

```sh
moosenexus build-image <build options> --language typescript -- \
  --repository https://github.com/fuhrmanator/FamixTypeScriptImporter.git \
  --revision 679f54e7a0990791e8dce3e437ff4915baebfdc5
```

The CLI unit tests cover configuration validation, optional package loading, generated local-runner scripts, and runtime profile separation; they do not execute ts2famix or import a TypeScript model.

## OCI Authentication

The CLI invokes the installed `oras` executable. Authenticate it before a publishing or pulling command using the authentication mechanism required by the registry, for example:

```sh
oras login registry.example.com
```

The CLI does not read registry credentials itself or define a separate credential environment variable.

## Runtime Cache and Environment

The CLI stores projects under `$MOOSENEXUS_HOME/repository` and caches Pharo VMs, Moose runtimes, and resolved MooseNexus release tags under `$MOOSENEXUS_HOME/runtime`. `MOOSENEXUS_HOME` defaults to `~/.moose`. The cache is immutable and version-keyed. Each operation copies a cached runtime into its temporary workspace before executing a MooseNexus script.

The CLI package version remains independent from MooseNexus. A CLI-only patch does not require a library release, and a library release can be selected explicitly with `--nexus-version`. The OCI end-to-end test uses the same floating `v1.x.x` default as ordinary CLI commands; `MOOSENEXUS_E2E_NEXUS_VERSION` overrides it for deliberate compatibility checks.

| Variable | Purpose |
| --- | --- |
| `MOOSENEXUS_RUNTIME_DIRECTORY` | Overrides the runtime cache location. Useful for CI caches or isolated builds. |
| `MOOSENEXUS_HOME` | Overrides the root containing the local repository and, unless overridden separately, the runtime cache. |
| `MOOSENEXUS_SPINNER_DISABLED` | Disables animated progress. Any value except `0`, `false`, or `no` disables it. |
| `GITHUB_TOKEN` | Authenticates GitHub API requests when resolving floating MooseNexus tracks or `--nexus-version latest`. |

When resolving a floating MooseNexus track such as `1.x.x`, the CLI first uses a fresh cached reference. The cache lifetime is 24 hours. It resolves the tag to an immutable Git commit and keys the runtime cache with that commit. `--refresh` fetches current Moose and MooseNexus references and replaces their cache entries, so later commands use the refreshed values until they expire or another refresh occurs. `latest` remains available as an explicit unbounded choice. If a token is absent, the CLI tries authenticated `gh` first, then uses the unauthenticated GitHub API. Pin `--moose`, `--pharo`, and `--nexus-version` in automated builds for reproducibility.

The CLI also follows the standard Node.js process environment:

| Variable | Purpose |
| --- | --- |
| `HOME` | Determines the default `~/.moose` repository and runtime-cache location. |
| `PATH` | Locates `oras`, `docker`, and `gh` when those tools are needed. |
| `TMPDIR` | Determines where isolated temporary build workspaces are created. |

Progress animation is enabled only for an interactive terminal. It is automatically disabled when `CI` is set or `TERM=dumb`.

## Further Reference

Run `moosenexus <command> --help` for the complete option list, including image/bootstrap overrides, OCI coordinates, shell completion generation, and logging controls.
