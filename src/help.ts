export const helpForArguments = (arguments_: ReadonlyArray<string>): string | undefined => {
  if (arguments_.length === 0 || isHelpFlag(arguments_[0])) return rootHelp
  if (arguments_[0] === "build-image" && isHelpRequest(arguments_.slice(1))) return buildImageHelp
  if (arguments_[0] === "build-model" && isHelpRequest(arguments_.slice(1))) return buildModelHelp
  if (arguments_[0] === "pull-image" && isHelpRequest(arguments_.slice(1))) return pullImageHelp
  if (arguments_[0] === "pull-model" && isHelpRequest(arguments_.slice(1))) return pullModelHelp
  if (arguments_[0] === "adopt-image" && isHelpRequest(arguments_.slice(1))) return adoptImageHelp
  if (arguments_[0] === "artifacts" && isHelpRequest(arguments_.slice(1))) return artifactsHelp
  return undefined
}

const isHelpRequest = (arguments_: ReadonlyArray<string>): boolean =>
  arguments_.includes("--help") || arguments_.includes("-h")

const isHelpFlag = (argument: string | undefined): boolean => argument === "--help" || argument === "-h"

const rootHelp = `MooseNexus CLI ${cliVersion}

Usage: moosenexus <command> [options]

Commands:
  build-image  Build, install, and optionally export or publish a Moose image artifact.
  build-model  Build, install, and optionally export or publish a Moose model artifact.
  pull-image   Download and install a published Moose image artifact.
  pull-model   Download and install a published Moose model artifact locally.
  adopt-image  Copy an installed image artifact into a mutable Pharo image folder.
  artifacts    List model and image artifacts installed in the local MooseNexus repository.

Run \`moosenexus <command> --help\` for command options.
Run \`moosenexus --wizard\` to build a command interactively.`

const buildImageHelp = `Usage: moosenexus build-image [coordinates] [source] [options]

Build a fresh Moose image containing a Moose model.

Input: provide --spec, or <group>:<name>:<version> with a source directory. Use --source and all three --project-* options instead of positional inputs when needed.

  -c, --config <file>                 YAML configuration file.
  --spec <file>                       Smalltalk expression that produces a MooseNexusBuildSpec.
  --project-group <group>             Project coordinate group.
  --project-name <name>               Project coordinate name.
  --project-version <version>         Project coordinate version.
  --source <path>                     Source project directory.
  --kind <kind>                       Project import kind. Default: auto.
  --language <java|typescript>        Source-project language when importer selection is ambiguous.
  --dependency-directory <path>       Local JAR directory; requires unmanaged MooseNexus v1+.
  --model-name <name>                 Model name. Default: project name.
  --description <text>                Description recorded with the model artifact.

Extractor Options:
  Append -- followed by options for the extractor selected by --language.

  Java / VerveineJ:
    --runner <local|docker>            How to run VerveineJ. Default: Docker.
    --directory <path>                 Local checkout; required for runner local.
    --version <version>                Docker image tag. Default: latest.
    -format <json|mse>                 Model format. Default: json.
    -alllocals                         Include local variables.
    -anchor <strategy>                 none, entity, default, or assoc.
    -excludepath <glob>                Excluded source path; may be repeated.
    -<java-version>                    Java source level, for example -17; VerveineJ default when omitted.
    --jvm-args <arguments>             Arguments passed to the VerveineJ JVM.
    -summary                           Enable summary output.

  Experimental TypeScript / ts2famix:
    --repository <url>                 Pinned ts2famix source repository.
    --revision <commit>                Pinned ts2famix source revision.

Runtime:
  --pharo <version>                   Pharo version. Default: latest compatible with Moose.
  --vm-url <url>                      Pharo VM bootstrap URL. Default: inferred from --pharo.
  --moose <version>                   Moose image version. Default: latest.
  --image-url <url>                   Moose image archive URL. Default: inferred from --moose and --pharo.
  --repository <url>                  MooseNexus source repository. Default: github://moosetechnology/MooseNexus.
  --nexus-version <version>           MooseNexus release or floating track. Default: 1.x.x.

Artifact:
  --out <path>                        Retain the portable ZIP in this directory.
  --registry <host>                   OCI registry host; provide with --namespace to publish.
  --namespace <path>                  OCI registry namespace; provide with --registry to publish.
  --force                             Replace a conflicting local project artifact. Default: false.
  --adopt                             Copy the installed image into the default Pharo images directory.
  --adopt-as <name>                   Copy the installed image using this local name.
  --adopt-to <path>                   Directory in which to copy the installed image.

Other:
  --dry-run                           Print the resolved workflow without executing it. Default: false.
  --refresh                           Refresh cached floating and latest release references.
  --keep                              Retain the temporary workspace. Default: false.
  --no-install                        Do not install the result; requires --out or OCI publication.
  -w, --wizard [--expert]             Interactively construct a valid command.
  --completions <shell>               Generate shell completions.
  --log-level <level>                 Set the minimum log level.
  -h, --help                          Show this help.`

const pullImageHelp = `Usage: moosenexus pull-image <coordinates> --registry <host> --namespace <path> [options]

Download and install a Moose image artifact.

Options:
  --registry <host>                   OCI registry host. [required]
  --namespace <path>                  OCI registry namespace. [required]
  <coordinates>                       Project coordinates: <group>:<name>:<version>. [required]
  --project-group <group>             Expanded coordinate group; use with --project-name and --project-version.
  --project-name <name>               Expanded coordinate name; use with --project-group and --project-version.
  --project-version <version>         Expanded coordinate version; use with --project-group and --project-name.
  --out <path>                        Install into an image-scoped directory. Default: local repository.
  --force                             Replace a conflicting installed artifact. Default: false.
  --adopt                             Adopt using the model name and default destination.
  --adopt-as <name>                   Adopt with a local image name.
  --adopt-to <path>                   Adopt into this directory. Default: ~/Documents/Pharo/images.
  --completions <shell>               Generate shell completions.
  --log-level <level>                 Set the minimum log level.
  -h, --help                          Show this help.`

const adoptImageHelp = `Usage: moosenexus adopt-image <coordinates> [options]

Copy an installed image artifact into a mutable Pharo image folder.

Options:
  <coordinates>                       Project coordinates: <group>:<name>:<version>. [required]
  --project-group <group>             Expanded coordinate group; use with --project-name and --project-version.
  --project-name <name>               Expanded coordinate name; use with --project-group and --project-version.
  --project-version <version>         Expanded coordinate version; use with --project-group and --project-name.
  --adopt-as <name>                   Local image name. Default: model name.
  --adopt-to <path>                   Directory in which to create the image. Default: ~/Documents/Pharo/images.
  --completions <shell>               Generate shell completions.
  --log-level <level>                 Set the minimum log level.
  -h, --help                          Show this help.`

const buildModelHelp = `Usage: moosenexus build-model [coordinates] [source] [options]

Build a Moose model artifact and install it locally. It can also export or publish its payload, metadata, and sources.

Input: provide --spec, or <group>:<name>:<version> with a source directory. Use --source and all three --project-* options instead of positional inputs when needed.

  -c, --config <file>                 YAML configuration file.
  --spec <file>                       Smalltalk expression that produces a MooseNexusBuildSpec.
  --project-group <group>             Project coordinate group.
  --project-name <name>               Project coordinate name.
  --project-version <version>         Project coordinate version.
  --source <path>                     Source project directory.
  --kind <kind>                       Project import kind. Default: auto.
  --language <java|typescript>        Source-project language when importer selection is ambiguous.
  --dependency-directory <path>       Local JAR directory; requires unmanaged MooseNexus v1+.
  --model-name <name>                 Model name. Default: project name.
  --description <text>                Description recorded with the model artifact.

Extractor Options:
  Append -- followed by options for the extractor selected by --language.

  Java / VerveineJ:
    --runner <local|docker>            How to run VerveineJ. Default: Docker.
    --directory <path>                 Local checkout; required for runner local.
    --version <version>                Docker image tag. Default: latest.
    -format <json|mse>                 Model format. Default: json.
    -alllocals                         Include local variables.
    -anchor <strategy>                 none, entity, default, or assoc.
    -excludepath <glob>                Excluded source path; may be repeated.
    -<java-version>                    Java source level, for example -17; VerveineJ default when omitted.
    --jvm-args <arguments>             Arguments passed to the VerveineJ JVM.
    -summary                           Enable summary output.
  Experimental TypeScript / ts2famix:
    --repository <url>                 Pinned ts2famix source repository.
    --revision <commit>                Pinned ts2famix source revision.
  --pharo <version>                   Pharo version. Default: latest compatible with Moose.
  --vm-url <url>                      Pharo VM bootstrap URL. Default: inferred from --pharo.
  --moose <version>                   Moose image version. Default: latest.
  --image-url <url>                   Moose image archive URL. Default: inferred from --moose and --pharo.
  --repository <url>                  MooseNexus source repository. Default: github://moosetechnology/MooseNexus.
  --nexus-version <version>           MooseNexus release or floating track. Default: 1.x.x.
  --registry <host>                   OCI registry host; provide with --namespace to publish.
  --namespace <path>                  OCI registry namespace; provide with --registry to publish.
  --out <path>                        Retain a portable project directory in this location.
  --force                             Replace a conflicting local project artifact. Default: false.
  --dry-run                           Print the resolved workflow without executing it. Default: false.
  --refresh                           Refresh cached floating and latest release references.
  --keep                              Retain the temporary workspace. Default: false.
  --no-install                        Do not install the result; requires --out or OCI publication.
  -h, --help                          Show this help.`

const pullModelHelp = `Usage: moosenexus pull-model <coordinates> --registry <host> --namespace <path> [options]

Download a Moose model artifact and install it in the local repository.

Options:
  --registry <host>                   OCI registry host. [required]
  --namespace <path>                  OCI registry namespace. [required]
  <coordinates>                       Project coordinates: <group>:<name>:<version>. [required]
  --project-group <group>             Expanded coordinate group; use with --project-name and --project-version.
  --project-name <name>               Expanded coordinate name; use with --project-group and --project-version.
  --project-version <version>         Expanded coordinate version; use with --project-group and --project-name.
  --force                             Fetch even when the project is already installed locally. Default: false.
  -h, --help                          Show this help.`

const artifactsHelp = `Usage: moosenexus artifacts [options]

List model and image artifacts installed in the local MooseNexus repository.

Options:
  --json                              Write machine-readable JSON.
  -h, --help                          Show this help.`
import { cliVersion } from "./version.js"
