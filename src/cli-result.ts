export interface CliResult<Result> {
  readonly operation: string
  readonly result: Result
  readonly schemaVersion: "1"
  readonly status: "success"
}

export const renderJsonResult = <Result>(operation: string, result: Result): string =>
  JSON.stringify({
    schemaVersion: "1",
    operation,
    status: "success",
    result
  } satisfies CliResult<Result>)

export const renderJsonPlan = <Plan>(operation: string, plan: Plan): string =>
  JSON.stringify({
    schemaVersion: "1",
    operation,
    status: "planned",
    plan
  })
