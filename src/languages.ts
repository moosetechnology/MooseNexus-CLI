export const supportedLanguages = ["java", "typescript"] as const

export type SupportedLanguage = typeof supportedLanguages[number]

export const defaultLanguage: SupportedLanguage = supportedLanguages[0]
