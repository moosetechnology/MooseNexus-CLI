export interface MooseNexusHeadlessResult {
  readonly schemaVersion: "1"
  readonly operation: string
  readonly phase: string
  readonly status: "success" | "failure"
  readonly code: string
  readonly message: string | null
  readonly context: Readonly<Record<string, unknown>>
}

export const parseHeadlessResult = (value: unknown): MooseNexusHeadlessResult => {
  if (!isRecord(value)) throw new Error("result is not a JSON object")

  const { schemaVersion, operation, phase, status, code, message, context } = value
  if (schemaVersion !== "1") throw new Error(`unsupported result schema version: ${String(schemaVersion)}`)
  if (typeof operation !== "string" || operation === "") throw new Error("result operation is missing")
  if (typeof phase !== "string" || phase === "") throw new Error("result phase is missing")
  if (status !== "success" && status !== "failure") throw new Error("result status is invalid")
  if (typeof code !== "string" || code === "") throw new Error("result code is missing")
  if (message !== null && typeof message !== "string") throw new Error("result message is invalid")
  if (!isRecord(context)) throw new Error("result context is invalid")

  return { schemaVersion, operation, phase, status, code, message, context }
}

export const headlessFailureMessage = (result: MooseNexusHeadlessResult): string => {
  const message = result.message ?? "MooseNexus reported an operation failure without a message"
  return `${message} (${result.code})`
}

export const supportsHeadlessOperationResults = (version: string): boolean => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.replace(/^v/, ""))
  if (match !== null) {
    const major = Number(match[1])
    const minor = Number(match[2])
    return major > 1 || (major === 1 && minor >= 1)
  }

  return /^1\.(?:[1-9]\d*|x)\.x$/.test(version)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
