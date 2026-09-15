import { homedir } from "node:os"
import { join } from "node:path"

export const mooseNexusHomeDirectory = (): string =>
  process.env.MOOSENEXUS_HOME ?? join(homedir(), ".moose")

export const runtimeDirectory = (): string =>
  process.env.MOOSENEXUS_RUNTIME_DIRECTORY ?? join(mooseNexusHomeDirectory(), "runtime")
