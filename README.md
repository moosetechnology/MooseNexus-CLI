# MooseNexus CLI

MooseNexus CLI builds, publishes, and retrieves Moose model and image artifacts.

It creates a fresh Moose/Pharo image, loads MooseNexus, runs a build specification, and can publish the resulting model or image through an OCI registry.

## Install

```sh
npm install --global moosenexus
```

The CLI requires Node.js 22 or later. Building Java models with the default extractor requires Docker. TypeScript support is experimental; it requires Git and npm, and the CLI provisions the pinned importer in its temporary workspace. OCI publication and retrieval require an authenticated ORAS installation.

## Get Started

Use the interactive wizard to build or retrieve an artifact step by step:

```sh
moosenexus --wizard
```

Build an image from a YAML configuration with inline build inputs:

```sh
moosenexus build-image --config examples/unmanaged-java.yml
```

Build an npm-managed TypeScript project experimentally:

```sh
moosenexus build-image --config examples/typescript-npm.yml
```

Build and publish a model from an external Smalltalk build spec:

```sh
moosenexus build-model --config examples/external-build-spec.yml
```

Build and publish a model:

```sh
moosenexus build-model \
  --project-group com.example \
  --project-name demo \
  --project-version 1.0.0 \
  --source /path/to/source/project \
  --kind unmanaged \
  --language java \
  --registry registry.example.com \
  --namespace moose
```

Retrieve that model:

```sh
moosenexus pull-model \
  --registry registry.example.com \
  --namespace moose \
  --project-group com.example \
  --project-name demo \
  --project-version 1.0.0
```

Run `moosenexus <command> --help` for command options.

## Documentation

- [CLI configuration and runtime behavior](docs/cli.md)
- [Development and end-to-end testing](docs/development.md)
