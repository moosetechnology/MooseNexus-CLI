import { stderr } from "node:process"
import type { WorkflowProgress, WorkflowStep } from "./workflow.js"

export class CliWorkflowProgress implements WorkflowProgress {
  private frameIndex = 0
  private timer: NodeJS.Timeout | undefined
  private current: WorkflowStep | undefined

  constructor(
    private readonly output: Pick<NodeJS.WriteStream, "write"> & { readonly columns?: number } = stderr,
    private readonly animated: boolean = spinnerEnabled()
  ) {}

  start(step: WorkflowStep): void {
    this.stopSpinner()
    this.current = step
    if (!this.animated) {
      this.output.write(`> ${step.detail}\n`)
      return
    }
    this.renderSpinner()
    this.timer = setInterval(() => this.renderSpinner(), 100)
    this.timer.unref()
  }

  complete(step: WorkflowStep): void {
    this.finish(step, "✓")
  }

  fail(step: WorkflowStep): void {
    this.finish(step, "✗")
  }

  skip(step: WorkflowStep): void {
    this.stopSpinner()
    this.output.write(`- ${step.detail}\n`)
  }

  private finish(step: WorkflowStep, marker: string): void {
    this.stopSpinner()
    const prefix = this.animated ? "\r\x1b[2K" : ""
    this.output.write(`${prefix}${coloredMarker(marker, this.animated)} ${step.detail}\n`)
  }

  private renderSpinner(): void {
    if (this.current === undefined) return
    const frame = spinnerFrames[this.frameIndex++ % spinnerFrames.length]
    this.output.write(`\r\x1b[2K\x1b[36m${frame}\x1b[0m ${spinnerLabel(this.current.detail, this.output.columns)}`)
  }

  private stopSpinner(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    this.current = undefined
  }
}

const spinnerFrames = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"]

export const spinnerEnabled = (
  environment: NodeJS.ProcessEnv = process.env,
  isTty: boolean = Boolean(stderr.isTTY)
): boolean =>
  isTty
    && !isEnabled(environment.CI)
    && environment.TERM !== "dumb"
    && !isEnabled(environment.MOOSENEXUS_SPINNER_DISABLED)

const isEnabled = (value: string | undefined): boolean =>
  value !== undefined && !["", "0", "false", "no"].includes(value.toLowerCase())

const coloredMarker = (marker: string, enabled: boolean): string => {
  if (!enabled) return marker
  if (marker === "✓") return `\x1b[32m${marker}\x1b[0m`
  if (marker === "✗") return `\x1b[31mX\x1b[0m`
  return marker
}

export const spinnerLabel = (detail: string, columns: number | undefined): string => {
  const limit = Math.max(20, (columns ?? 80) - 4)
  return detail.length <= limit ? detail : `${detail.slice(0, limit - 3)}...`
}
