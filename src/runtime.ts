import { homedir } from "node:os"
import { join } from "node:path"

export const runtimeDirectory = (): string =>
  process.env.MOOSENEXUS_RUNTIME_DIRECTORY ?? join(homedir(), ".moose", "runtime")
