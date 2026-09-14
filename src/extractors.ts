import type { CliConfig } from "./config.js"
import { defaultTs2FamixConfig } from "./config.js"
import { parseTs2FamixOptions } from "./ts2famix.js"
import { parseVerveineJOptions, runVerveineJWizard } from "./verveinej.js"

interface ExtractorCli {
  readonly language: string
  parseOptions: (arguments_: ReadonlyArray<string>, configured: CliConfig["buildSpec"]) => ExtractorConfiguration
  runWizard: () => Promise<ReadonlyArray<string>>
}

interface ExtractorConfiguration {
  readonly ts2famix?: CliConfig["buildSpec"]["ts2famix"]
  readonly verveineJ?: CliConfig["buildSpec"]["verveineJ"]
}

const verveineJ: ExtractorCli = {
  language: "java",
  parseOptions: (arguments_, configured) => ({
    verveineJ: parseVerveineJOptions(arguments_, configured.verveineJ)
  }),
  runWizard: runVerveineJWizard
}

const ts2famix: ExtractorCli = {
  language: "typescript",
  parseOptions: (arguments_, configured) => ({
    ts2famix: parseTs2FamixOptions(arguments_, configured.ts2famix)
  }),
  runWizard: async () => []
}

const extractors = [verveineJ, ts2famix]

export const resolveExtractorConfiguration = (
  language: string | undefined,
  arguments_: ReadonlyArray<string>,
  configured: CliConfig["buildSpec"]
): ExtractorConfiguration => {
  if (language === "typescript" && arguments_.length === 0) {
    return { ts2famix: configured.ts2famix ?? defaultTs2FamixConfig }
  }
  if (arguments_.length === 0) {
    return {
      verveineJ: configured.verveineJ,
      ts2famix: configured.ts2famix
    }
  }

  const extractor = extractors.find((candidate) => candidate.language === language)
  if (extractor === undefined) {
    throw new Error(`Extractor options after -- require a supported language. Received: ${language ?? "none"}.`)
  }
  return extractor.parseOptions(arguments_, configured)
}

export const runExtractorWizard = async (language: string | undefined): Promise<ReadonlyArray<string>> => {
  const extractor = extractors.find((candidate) => candidate.language === language)
  return extractor === undefined ? [] : extractor.runWizard()
}
