import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const packageJson = require("../package.json") as { readonly version: string }

export const cliVersion = packageJson.version
