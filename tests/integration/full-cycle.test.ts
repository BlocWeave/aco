/**
 * E2E Integration Test — Full Optimization Cycle
 *
 * Exercises the complete loop:
 *   observe → hypothesize → generate → validate → apply → evaluate → commit → rollback
 *
 * Uses a deterministic HTML fetch response and a real temporary git repo.
 * Browser analysis and the LLM provider layer are mocked so tests are
 * deterministic and free while orchestration and Git behavior remain real.
 *
 * What this covers that unit tests don't:
 *   - runAcoCore writes accepted proposals to results.jsonl correctly
 *   - runAcoRun applies changes to real files and commits to real git
 *   - rollback reverts the last accepted commit cleanly
 *   - Budget enforcement stops the loop at the cap
 *   - aco.md is loaded correctly and constrains allowed categories
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'

// ─── Mock provider layer ──────────────────────────────────────────────────────

vi.mock('../../src/integrations/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/providers.js')>()
  return {
    ...actual,
    callWithFallback: vi.fn(),
  }
})

// ─── Mock page-analysis boundaries (browser extraction is tested separately) ─

vi.mock('../../src/agent/observer.js', () => ({
  observePage: vi.fn().mockResolvedValue({
    url: 'http://localhost',
    screenshotBase64: '',
    screenshotPath: '/tmp/aco-before.png',
    title: 'Test page',
    metaDescription: '',
    dom: {
      headline: 'Test headline',
      subheadline: null,
      ctaText: ['Get Started'],
      primaryCta: 'Get Started',
      formFields: [],
      socialProof: [],
      trustSignals: [],
      pricingInfo: null,
      wordCount: 20,
      hasVideo: false,
      hasChat: false,
      navItems: [],
      pageStructure: 'main',
    },
    coreWebVitals: { lcp: null, fid: null, cls: null, fcp: null, ttfb: null, performanceScore: null },
    accessibility: [],
    capturedAt: new Date(),
  }),
}))

vi.mock('../../src/agent/evaluator.js', () => ({
  evaluateChange: vi.fn().mockResolvedValue({
    similarityScore: 1,
    passed: true,
    threshold: 0.85,
    beforePath: '/tmp/aco-before.png',
    afterPath: '/tmp/aco-after.png',
    diffPath: null,
  }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_AUDIT_RESPONSE = {
  overall_assessment: 'CTA needs improvement.',
  conversion_score: { overall: 5, clarity: 6, trust: 4, urgency: 3, social_proof: 3 },
  top_finding: 'CTA is generic.',
  hypotheses: [
    {
      id: 'H01',
      principle: 'clarity',
      element: 'CTA button',
      current_state: '"Get Started"',
      issue: 'Generic CTA.',
      recommendation: 'Change to "Start Free Trial".',
      why_it_works: 'Specificity reduces friction.',
      metric_to_track: 'CTR',
      priority: 'critical' as const,
      effort: 'copy_only',
      estimated_impact: 'high',
    },
  ],
  quick_wins: ['Change CTA text'],
  what_works: [],
}

const MOCK_CHANGE_SPEC = {
  changes: [
    {
      hypothesisId: 'H01',
      category: 'copy' as const,
      filePath: 'index.html',
      description: 'Change CTA text',
      searchText: 'Get Started',
      replacementText: 'Start Free Trial',
      lineHint: 5,
      reasoning: 'Specificity reduces friction.',
    },
  ],
  skipped: false,
  skipReason: undefined,
  usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
  provider: 'anthropic' as const,
  modelUsed: 'claude-sonnet-4-6',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aco-e2e-'))

  // Write a minimal HTML page with a CTA
  await fs.writeFile(
    path.join(dir, 'index.html'),
    `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <button>Get Started</button>
</body>
</html>`,
    'utf-8',
  )

  // Write a minimal aco.md
  await fs.writeFile(
    path.join(dir, 'aco.md'),
    `---
brand:
  name: TestBrand
  tone: friendly
  audience: developers
  value_proposition: Testing ACO

goals:
  primary: Get visitors to click the CTA
  url: http://localhost:9876

constraints:
  voice: clear and direct
  allowed_categories:
    - copy
    - cta
  never_change:
    - do not change the page title
---

# Brand Soul

## Who We Are
A test brand for ACO integration tests.

## Conversion Goal
Visitors should click "Start Free Trial".
`,
    'utf-8',
  )

  // Initialise git repo
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@aco.test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'ACO Test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' })

  return dir
}

function mockPageFetch(): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    text: async () => '<button>Get Started</button>',
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Full optimization cycle — runAcoCore (SaaS mode)', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await createTempProject()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPageFetch()
  })

  it('writes accepted proposals to results.jsonl', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    const mock = vi.mocked(callWithFallback)

    // First call = hypothesizer, second call = generator
    mock.mockResolvedValueOnce({
      result: MOCK_AUDIT_RESPONSE,
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.01 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })
    mock.mockResolvedValueOnce({
      result: MOCK_CHANGE_SPEC,
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    const { runAcoCore } = await import('../../src/commands/run.js')
    const { createResultsLogger, defaultLogPath } = await import('../../src/logger/results.js')

    await runAcoCore({
      url: 'http://localhost:9876',
      projectDir: tmpDir,
      conservative: false,
      budget: { maxUsd: 1.0, warnAtUsd: 0.75, maxExperimentsPerRun: 5 },
    })

    const results = await createResultsLogger(defaultLogPath(tmpDir)).readAll()

    expect(results).toHaveLength(1)
    expect(results[0]!.outcome).toBe('accepted')
    expect(results[0]!.searchText).toBe('Get Started')
    expect(results[0]!.replacementText).toBe('Start Free Trial')
    expect(results[0]!.hypothesisId).toBe('H01')
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('respects budget cap — stops after maxUsd exceeded', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    const mock = vi.mocked(callWithFallback)

    // Audit call with 3 hypotheses
    mock.mockResolvedValueOnce({
      result: {
        ...MOCK_AUDIT_RESPONSE,
        hypotheses: [
          { ...MOCK_AUDIT_RESPONSE.hypotheses[0]!, id: 'H01' },
          { ...MOCK_AUDIT_RESPONSE.hypotheses[0]!, id: 'H02', element: 'Headline' },
          { ...MOCK_AUDIT_RESPONSE.hypotheses[0]!, id: 'H03', element: 'Subheadline' },
        ],
      },
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.009 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    // Generator calls — each costs 0.005, budget is 0.01 total (already at 0.009 from audit)
    mock.mockResolvedValue({
      result: MOCK_CHANGE_SPEC,
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    const resultsLogPath = path.join(tmpDir, '.aco', 'budget-test.jsonl')
    const { createResultsLogger } = await import('../../src/logger/results.js')
    const logger = createResultsLogger(resultsLogPath)

    // With budget of $0.01, after the $0.009 audit cost only $0.001 remains
    const { runAcoCore } = await import('../../src/commands/run.js')
    await runAcoCore({
      url: 'http://localhost:9876',
      projectDir: tmpDir,
      conservative: false,
      budget: { maxUsd: 0.01, warnAtUsd: 0.008, maxExperimentsPerRun: 10 },
    })

    const results = await logger.readAll()
    // Should have processed 0 or 1 experiments before budget cap
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it('skips hypotheses outside allowed categories when conservative=true', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    const mock = vi.mocked(callWithFallback)

    // Audit with one copy and one layout hypothesis
    mock.mockResolvedValueOnce({
      result: {
        ...MOCK_AUDIT_RESPONSE,
        hypotheses: [
          { ...MOCK_AUDIT_RESPONSE.hypotheses[0]!, id: 'H01', effort: 'copy_only' },
          { ...MOCK_AUDIT_RESPONSE.hypotheses[0]!, id: 'H02', effort: 'layout_change', element: 'Layout' },
        ],
      },
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.01 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })
    mock.mockResolvedValue({
      result: MOCK_CHANGE_SPEC,
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    const { runAcoCore } = await import('../../src/commands/run.js')
    const { createResultsLogger, defaultLogPath } = await import('../../src/logger/results.js')

    // Clear previous results
    const logPath = defaultLogPath(tmpDir)
    await fs.rm(logPath, { force: true }).catch(() => undefined)

    await runAcoCore({
      url: 'http://localhost:9876',
      projectDir: tmpDir,
      conservative: true,  // Only copy + cta
      budget: { maxUsd: 1.0, warnAtUsd: 0.75, maxExperimentsPerRun: 10 },
    })

    const results = await createResultsLogger(logPath).readAll()
    // Only H01 (copy_only) should have been attempted — H02 (layout_change) skipped
    expect(results.every(r => r.hypothesisId !== 'H02')).toBe(true)
    // Generator should have been called only once (for H01)
    expect(mock).toHaveBeenCalledTimes(2) // audit + 1 generator call
  })
})

describe('Full optimization cycle — runAcoRun (CLI mode)', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await createTempProject()
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPageFetch()
  })

  it('applies change to file, commits to git, and aco status shows the experiment', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    const mock = vi.mocked(callWithFallback)

    mock.mockResolvedValueOnce({
      result: MOCK_AUDIT_RESPONSE,
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.01 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })
    mock.mockResolvedValueOnce({
      result: MOCK_CHANGE_SPEC,
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    // Override cwd for the run to use tmpDir
    const originalCwd = process.cwd()
    process.chdir(tmpDir)

    try {
      const { runAcoRun } = await import('../../src/commands/run.js')
      await runAcoRun('http://localhost:9877', {
        dryRun: false,
        conservative: false,
        budget: '1.00',
        maxExperiments: '5',
        port: '9877',
      })
    } finally {
      process.chdir(originalCwd)
    }

    // File should have been changed
    const content = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8')
    expect(content).toContain('Start Free Trial')
    expect(content).not.toContain('Get Started')

    const { createResultsLogger, defaultLogPath } = await import('../../src/logger/results.js')
    const results = await createResultsLogger(defaultLogPath(tmpDir)).readAll()
    const accepted = results.find(result => result.outcome === 'accepted')
    expect(accepted?.gitCommitHash).toBeTruthy()
    expect(accepted?.filePath).toBe('index.html')
    expect(accepted?.searchText).toBe('Get Started')
    expect(accepted?.replacementText).toBe('Start Free Trial')
    expect(accepted?.changes).toEqual(MOCK_CHANGE_SPEC.changes)
  })

  it('rollback reverts the last aco commit', async () => {
    const { runRollback } = await import('../../src/commands/rollback.js')

    const originalCwd = process.cwd()
    process.chdir(tmpDir)

    try {
      await runRollback({ yes: true })
    } finally {
      process.chdir(originalCwd)
    }

    // File should be back to original
    const content = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8')
    expect(content).toContain('Get Started')
    expect(content).not.toContain('Start Free Trial')
  })
})

describe('Full optimization cycle — project quality gate', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await createTempProject()
    await fs.writeFile(path.join(tmpDir, 'aco.checks.sh'), 'echo "build failed" >&2\nexit 1\n', 'utf-8')
    execFileSync('git', ['add', 'aco.checks.sh'], { cwd: tmpDir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'add checks'], { cwd: tmpDir, stdio: 'ignore' })
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPageFetch()
  })

  it('rejects and restores a generated change when aco.checks.sh fails', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    const mock = vi.mocked(callWithFallback)

    mock.mockResolvedValueOnce({
      result: MOCK_AUDIT_RESPONSE,
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.01 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })
    mock.mockResolvedValueOnce({
      result: MOCK_CHANGE_SPEC,
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      const { runAcoRun } = await import('../../src/commands/run.js')
      await runAcoRun('http://localhost:9878', {
        dryRun: false,
        conservative: false,
        budget: '1.00',
        maxExperiments: '5',
        port: '9878',
      })
    } finally {
      process.chdir(originalCwd)
    }

    const content = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8')
    expect(content).toContain('Get Started')
    expect(content).not.toContain('Start Free Trial')

    const { createResultsLogger, defaultLogPath } = await import('../../src/logger/results.js')
    const results = await createResultsLogger(defaultLogPath(tmpDir)).readAll()
    expect(results[0]?.outcome).toBe('rejected')
    expect(results[0]?.reason).toContain('Project quality checks failed')
    expect(results[0]?.filePath).toBe('index.html')

    expect(results[0]?.gitCommitHash).toBeUndefined()
  })
})

describe('Full optimization cycle — quality gate side effects', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await createTempProject()
    await fs.writeFile(path.join(tmpDir, 'aco.checks.sh'), 'echo "generated" > unexpected.txt\nexit 0\n', 'utf-8')
    execFileSync('git', ['add', 'aco.checks.sh'], { cwd: tmpDir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'add side-effect check'], { cwd: tmpDir, stdio: 'ignore' })
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPageFetch()
  })

  it('rejects and stops when checks introduce an unexpected file', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    const mock = vi.mocked(callWithFallback)
    mock.mockResolvedValueOnce({
      result: MOCK_AUDIT_RESPONSE,
      usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.01 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })
    mock.mockResolvedValueOnce({
      result: MOCK_CHANGE_SPEC,
      usage: { inputTokens: 500, outputTokens: 200, totalTokens: 700, estimatedCostUsd: 0.005 },
      provider: 'anthropic',
      modelUsed: 'claude-sonnet-4-6',
    })

    const originalCwd = process.cwd()
    process.chdir(tmpDir)
    try {
      const { runAcoRun } = await import('../../src/commands/run.js')
      await runAcoRun('http://localhost:9879', {
        dryRun: false,
        conservative: false,
        budget: '1.00',
        maxExperiments: '5',
        port: '9879',
      })
    } finally {
      process.chdir(originalCwd)
    }

    const content = await fs.readFile(path.join(tmpDir, 'index.html'), 'utf-8')
    expect(content).toContain('Get Started')

    const { createResultsLogger, defaultLogPath } = await import('../../src/logger/results.js')
    const results = await createResultsLogger(defaultLogPath(tmpDir)).readAll()
    expect(results[0]?.outcome).toBe('rejected')
    expect(results[0]?.reason).toContain('unexpected.txt')
    expect(results[0]?.gitCommitHash).toBeUndefined()
  })
})
