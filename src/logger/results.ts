import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ExperimentResultSchema, type ExperimentResult } from '../types.js'

// ─── Run Summary ──────────────────────────────────────────────────────────

export interface RunSummary {
  runId: string
  totalExperiments: number
  accepted: number
  rejected: number
  skipped: number
  errors: number
  totalCostUsd: number
  hypothesesTried: string[]
}

// ─── Results Logger ───────────────────────────────────────────────────────

export interface ResultsLogger {
  append(result: ExperimentResult): Promise<void>
  readAll(): Promise<ExperimentResult[]>
  getRunSummary(runId: string): Promise<RunSummary>
  getLastAccepted(): Promise<ExperimentResult | null>
}

class ResultsLoggerImpl implements ResultsLogger {
  constructor(readonly logPath: string) {}

  async append(result: ExperimentResult): Promise<void> {
    // Validate before writing — prevents corrupt log entries
    ExperimentResultSchema.parse(result)

    await fs.mkdir(path.dirname(this.logPath), { recursive: true })
    await fs.appendFile(this.logPath, JSON.stringify(result) + '\n', 'utf-8')
  }

  async readAll(): Promise<ExperimentResult[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.logPath, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }

    const results: ExperimentResult[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        console.warn(`[results] Skipping malformed JSONL line: ${line.slice(0, 80)}`)
        continue
      }

      const validated = ExperimentResultSchema.safeParse(parsed)
      if (validated.success) {
        results.push(validated.data)
      } else {
        console.warn(`[results] Skipping line that failed schema validation: ${validated.error.message}`)
      }
    }

    return results
  }

  async getRunSummary(runId: string): Promise<RunSummary> {
    const all = await this.readAll()
    const forRun = all.filter(r => r.runId === runId)

    const summary: RunSummary = {
      runId,
      totalExperiments: forRun.length,
      accepted: 0,
      rejected: 0,
      skipped: 0,
      errors: 0,
      totalCostUsd: 0,
      hypothesesTried: [],
    }

    for (const r of forRun) {
      if (r.outcome === 'accepted') summary.accepted++
      else if (r.outcome === 'rejected') summary.rejected++
      else if (r.outcome === 'skipped') summary.skipped++
      else if (r.outcome === 'error') summary.errors++

      summary.totalCostUsd += r.costUsd
      if (!summary.hypothesesTried.includes(r.hypothesisId)) {
        summary.hypothesesTried.push(r.hypothesisId)
      }
    }

    return summary
  }

  async getLastAccepted(): Promise<ExperimentResult | null> {
    const all = await this.readAll()
    // Walk backwards to find the most recent accepted result
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i]
      if (r && r.outcome === 'accepted') return r
    }
    return null
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

export function createResultsLogger(logPath: string): ResultsLogger {
  return new ResultsLoggerImpl(logPath)
}

// ─── Default log path ─────────────────────────────────────────────────────

export function defaultLogPath(projectDir: string): string {
  return path.join(projectDir, '.aco', 'results.jsonl')
}
