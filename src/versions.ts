export const normalizeMooseVersion = (version: string): string => {
  if (version === "latest") return version

  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(version)
  if (match === null) return version

  return `${match[1]}.${match[2] ?? "0"}.${match[3] ?? "0"}`
}
