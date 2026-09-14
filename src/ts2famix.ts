import type { CliConfig } from "./config.js"
import { defaultTs2FamixConfig } from "./config.js"

type Ts2FamixConfiguration = NonNullable<CliConfig["buildSpec"]["ts2famix"]>
type Ts2FamixOptionPatch = { -readonly [Key in keyof Ts2FamixConfiguration]?: Ts2FamixConfiguration[Key] }

export const parseTs2FamixOptions = (
  arguments_: ReadonlyArray<string>,
  configured: Ts2FamixConfiguration | undefined
): Ts2FamixConfiguration => {
  const patch: Ts2FamixOptionPatch = {}

  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index]
    if (argument === undefined) break
    switch (argument) {
      case "--repository":
        patch.repository = nextValue(arguments_, ++index, argument)
        break
      case "--revision":
        patch.revision = nextValue(arguments_, ++index, argument)
        break
      default:
        throw new Error(`Unknown ts2famix option after --: ${argument}.`)
    }
  }

  return {
    ...defaultTs2FamixConfig,
    ...configured,
    ...patch
  }
}

const nextValue = (arguments_: ReadonlyArray<string>, index: number, option: string): string => {
  const value = arguments_[index]
  if (value === undefined) throw new Error(`${option} requires a value.`)
  return value
}
