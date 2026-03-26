import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { createResultsLogger } from '../../src/logger/results.js'
import type { ExperimentResult } from '../../src/types.js'

// ─── Fixture ──────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ExperimentResult> = {}): ExperimentResult {
  return {
    experimentId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    hypothesisId: 'H01',
    category: 'copy',
    filePath: 'app/page.tsx',
    searchText: 'Get Started',
    replacementText: 'Start Your Free Trial',
    outcome: 'accepted',
    reason: 'Visual regression passed',
    costUsd: 0.012,
    cumulativeRunCostUsd: 0.024,
    provider: 'anthropic',
    modelUsed: 'claude-sonnet-4-6',
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ResultsLogger', () => {
  let tmpDir: string
  let logPath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aco-results-test-'))
    logPath = path.join(tmpDir, 'results.jsonl')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // ── append ──────────────────────────────────────────────────────────────

  it('creates the log file on first append', async () => {
    const logger = createResultsLogger(logPath)
    await logger.append(makeResult())
    await expect(fs.access(logPath)).resolves.toBeUndefined()
  })

  it('writes one valid JSON line per record', async () => {
    const logger = createResultsLogger(logPath)
    const r = makeResult()
    await logger.append(r)

    const content = await fs.readFile(logPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ experimentId: r.experimentId })
  })

  it('appends multiple records without overwriting', async () => {
    const logger = createResultsLogger(logPath)
    await logger.append(makeResult({ hypothesisId: 'H01' }))
    await logger.append(makeResult({ hypothesisId: 'H02' }))
    await logger.append(makeResult({ hypothesisId: 'H03' }))

    const all = await logger.readAll()
    expect(all).toHaveLength(3)
  })

  it('creates parent directories if they do not exist', async () => {
    const deepPath = path.join(tmpDir, 'nested', 'dir', 'results.jsonl')
    const logger = createResultsLogger(deepPath)
    await logger.append(makeResult())
    await expect(fs.access(deepPath)).resolves.toBeUndefined()
  })

  // ── readAll ─────────────────────────────────────────────────────────────

  it('returns empty array when file does not exist', async () => {
    const logger = createResultsLogger(path.join(tmpDir, 'nonexistent.jsonl'))
    expect(await logger.readAll()).toEqual([])
  })

  it('returns empty array for an empty file', async () => {
    await fs.writeFile(logPath, '', 'utf-8')
    const logger = createResultsLogger(logPath)
    expect(await logger.readAll()).toEqual([])
  })

  it('skips blank lines without throwing', async () => {
    await fs.writeFile(logPath, '\n\n\n', 'utf-8')
    const logger = createResultsLogger(logPath)
    expect(await logger.readAll()).toEqual([])
  })

  it('skips lines with invalid JSON without throwing', async () => {
    const good = JSON.stringify(makeResult())
    await fs.writeFile(logPath, `${good}\nnot-json\n${good}\n`, 'utf-8')
    const logger = createResultsLogger(logPath)
    const all = await logger.readAll()
    expect(all).toHaveLength(2)
  })

  it('skips lines that fail schema validation without throwing', async () => {
    const good = JSON.stringify(makeResult())
    const bad = JSON.stringify({ incomplete: true })
    await fs.writeFile(logPath, `${good}\n${bad}\n`, 'utf-8')
    const logger = createResultsLogger(logPath)
    const all = await logger.readAll()
    expect(all).toHaveLength(1)
  })

  // ── getLastAccepted ──────────────────────────────────────────────────────

  it('returns null when no results exist', async () => {
    const logger = createResultsLogger(logPath)
    expect(await logger.getLastAccepted()).toBeNull()
  })

  it('returns null when no accepted results exist', async () => {
    const logger = createResultsLogger(logPath)
    await logger.append(makeResult({ outcome: 'rejected' }))
    await logger.append(makeResult({ outcome: 'skipped' }))
    expect(await logger.getLastAccepted()).toBeNull()
  })

  it('returns the most recent accepted result', async () => {
    const logger = createResultsLogger(logPath)
    const r1 = makeResult({ hypothesisId: 'H01', outcome: 'accepted', gitCommitHash: 'abc123' })
    const r2 = makeResult({ hypothesisId: 'H02', outcome: 'rejected' })
    const r3 = makeResult({ hypothesisId: 'H03', outcome: 'accepted', gitCommitHash: 'def456' })
    await logger.append(r1)
    await logger.append(r2)
    await logger.append(r3)

    const last = await logger.getLastAccepted()
    expect(last?.hypothesisId).toBe('H03')
    expect(last?.gitCommitHash).toBe('def456')
  })

  // ── getRunSummary ────────────────────────────────────────────────────────

  it('returns correct counts for a run', async () => {
    const logger = createResultsLogger(logPath)
    const runId = crypto.randomUUID()
    await logger.append(makeResult({ runId, outcome: 'accepted' }))
    await logger.append(makeResult({ runId, outcome: 'accepted' }))
    await logger.append(makeResult({ runId, outcome: 'rejected' }))
    await logger.append(makeResult({ runId, outcome: 'skipped' }))
    // From a different run — should not be counted
    await logger.append(makeResult({ runId: crypto.randomUUID(), outcome: 'accepted' }))

    const summary = await logger.getRunSummary(runId)
    expect(summary.totalExperiments).toBe(4)
    expect(summary.accepted).toBe(2)
    expect(summary.rejected).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.errors).toBe(0)
  })

  it('sums cost correctly for a run', async () => {
    const logger = createResultsLogger(logPath)
    const runId = crypto.randomUUID()
    await logger.append(makeResult({ runId, costUsd: 0.010 }))
    await logger.append(makeResult({ runId, costUsd: 0.020 }))

    const summary = await logger.getRunSummary(runId)
    expect(summary.totalCostUsd).toBeCloseTo(0.030, 5)
  })

  it('returns empty summary for unknown runId', async () => {
    const logger = createResultsLogger(logPath)
    await logger.append(makeResult())

    const summary = await logger.getRunSummary('nonexistent-run-id')
    expect(summary.totalExperiments).toBe(0)
    expect(summary.accepted).toBe(0)
  })
})
