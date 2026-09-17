import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface DoctorCheck {
  readonly capability: string
  readonly detail: string
  readonly status: "available" | "unavailable"
}

export interface DoctorReport {
  readonly checks: ReadonlyArray<DoctorCheck>
  readonly nodeVersion: string
}

type CommandRunner = (command: string, arguments_: ReadonlyArray<string>) => Promise<string>

export const inspectEnvironment = async (
  commandRunner: CommandRunner = commandVersion,
  nodeVersion = process.version
): Promise<DoctorReport> => ({
  nodeVersion,
  checks: await Promise.all(commandChecks.map((check) => inspectCommand(check, commandRunner)))
})

export const renderDoctorReport = (report: DoctorReport): string => [
  "MooseNexus environment",
  `Node.js ${report.nodeVersion}`,
  "",
  ...report.checks.map((check) => `${check.status === "available" ? "✓" : "!"} ${check.capability}: ${check.detail}`)
].join("\n")

const commandChecks: ReadonlyArray<{
  readonly arguments: ReadonlyArray<string>
  readonly capability: string
  readonly command: string
  readonly unavailableDetail: string
}> = [
  {
    capability: "ORAS",
    command: "oras",
    arguments: ["version"],
    unavailableDetail: "unavailable; required to publish or pull OCI artifacts"
  },
  {
    capability: "Docker",
    command: "docker",
    arguments: ["--version"],
    unavailableDetail: "unavailable; required by Docker-backed extractors"
  },
  {
    capability: "Git",
    command: "git",
    arguments: ["--version"],
    unavailableDetail: "unavailable; required to provision ts2famix"
  },
  {
    capability: "npm",
    command: "npm",
    arguments: ["--version"],
    unavailableDetail: "unavailable; required to provision ts2famix"
  },
  {
    capability: "Java",
    command: "java",
    arguments: ["-version"],
    unavailableDetail: "unavailable; required by Maven, Gradle, and local Java extraction"
  },
  {
    capability: "Maven",
    command: "mvn",
    arguments: ["--version"],
    unavailableDetail: "unavailable; required for Maven projects"
  },
  {
    capability: "Gradle",
    command: "gradle",
    arguments: ["--version"],
    unavailableDetail: "unavailable; required for Gradle projects"
  },
  {
    capability: "zip",
    command: "zip",
    arguments: ["-v"],
    unavailableDetail: "unavailable; required to create image bundles"
  },
  {
    capability: "unzip",
    command: "unzip",
    arguments: ["-v"],
    unavailableDetail: "unavailable; required to unpack Moose and image bundles"
  }
]

const inspectCommand = async (
  check: typeof commandChecks[number],
  commandRunner: CommandRunner
): Promise<DoctorCheck> => {
  try {
    const output = await commandRunner(check.command, check.arguments)
    return {
      capability: check.capability,
      status: "available",
      detail: firstMeaningfulLine(output) || "available"
    }
  } catch {
    return {
      capability: check.capability,
      status: "unavailable",
      detail: check.unavailableDetail
    }
  }
}

const commandVersion = async (command: string, arguments_: ReadonlyArray<string>): Promise<string> => {
  const { stdout, stderr } = await execFileAsync(command, arguments_)
  return `${stdout}\n${stderr}`
}

const firstMeaningfulLine = (output: string): string =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /[A-Za-z0-9]/.test(line))
    ?? ""
