import { Effect } from "effect"
import { spawn } from "node:child_process"

export interface CommandResult {
  readonly command: string
  readonly arguments: ReadonlyArray<string>
  readonly output: string
}

export class CommandFailure extends Error {
  constructor(
    readonly command: string,
    readonly commandArguments: ReadonlyArray<string>,
    readonly exitCode: number | null,
    readonly output: string,
    cause?: unknown
  ) {
    super([
      `Command failed: ${formatCommand(command, commandArguments)}${exitCode === null ? "" : ` (exit code ${exitCode})`}`,
      ...(output.trim() === "" ? [] : [output.trim()])
    ].join("\n"))
    this.name = "CommandFailure"
    this.cause = cause
  }
}

export const runCommand = (
  command: string,
  arguments_: ReadonlyArray<string>,
  options: { readonly cwd?: string } = {}
): Effect.Effect<CommandResult, CommandFailure> =>
  Effect.tryPromise({
    try: () => new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, arguments_, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"]
      })
      let output = ""

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString()
      })
      child.on("error", (error) => {
        reject(new CommandFailure(command, arguments_, null, output, error))
      })
      child.on("close", (exitCode) => {
        if (exitCode === 0) {
          resolve({ command, arguments: arguments_, output })
        } else {
          reject(new CommandFailure(command, arguments_, exitCode, output))
        }
      })
    }),
    catch: (error) => error instanceof CommandFailure
      ? error
      : new CommandFailure(command, arguments_, null, "", error)
  })

export const formatCommand = (command: string, arguments_: ReadonlyArray<string>): string =>
  [command, ...arguments_].map(shellQuote).join(" ")

const shellQuote = (value: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\\"'\\\"'")}'`
