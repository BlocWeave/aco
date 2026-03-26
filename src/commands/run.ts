import chalk from 'chalk'
import ora from 'ora'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { observePage } from '../agent/observer.js'
import { generateHypotheses } from '../agent/hypothesizer.js'
import { generateChanges, validateChangeSpec } from '../agent/generator.js'
import { evaluateChange } from '../agent/evaluator.js'
import { createGitClient } from '../integrations/git.js'
import { createResultsLogger, defaultLogPath } from '../logger/results.js'
import { loadAcoConfig } from '../config/program.js'
import { DEFAULT_BUDGET, type BudgetConfig, type ChangeCategory, type ExperimentResult } from '../types.js'

// ─── Options ──────────────────────────────────────────────────────────────

export interface RunCommandOptions {
  dryRun: boolean
  conservative: boolean
  budget: string
  maxExperiments: string
  port: string
  url?: string
}

// ─── Budget parsing ───────────────────────────────────────────────────────

export function parseBudget(raw: string, maxExperiments: string): BudgetConfig {
  const cleaned = raw.replace(/^\$/, '')
  const maxUsd = parseFloat(cleaned)
  if (isNaN(maxUsd) || maxUsd <= 0) {
    throw new Error(`Invalid budget value: "${raw}". Example: --budget 2.50`)
  }

  const maxExperimentsNum = parseInt(maxExperiments, 10)
  if (isNaN(maxExperimentsNum) || maxExperimentsNum <= 0) {
    throw new Error(`Invalid max-experiments value: "${maxExperiments}". Must be a positive integer.`)
  }

  return {
    ...DEFAULT_BUDGET,
    maxUsd,
    warnAtUsd: maxUsd * 0.75,
    maxExperimentsPerRun: maxExperimentsNum,
  }
}

// ─── Dev server polling ───────────────────────────────────────────────────
// Wait for the local dev server to reflect file changes (HMR rebuild)

async function waitForDevServer(url: string, maxAttempts = 20, intervalMs = 750): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      // Server still rebuilding
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

// ─── Apply a single text change to a file ─────────────────────────────────

async function applyChange(projectDir: string, filePath: string, searchText: string, replacementText: string): Promise<void> {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath)

  // Guard against LLM-generated paths that escape the project directory
  const normalizedPath = path.normalize(absPath)
  const normalizedProject = path.normalize(projectDir)
  if (!normalizedPath.startsWith(normalizedProject + path.sep)) {
    throw new Error(`Path traversal detected: "${filePath}" is outside the project directory`)
  }

  const content = await fs.readFile(normalizedPath, 'utf-8')
  const updated = content.replace(searchText, replacementText)
  await fs.writeFile(normalizedPath, updated, 'utf-8')
}

// ─── Library API — used by the SaaS worker ────────────────────────────────
//
// Runs the observe → hypothesize → generate loop against a live URL and
// writes proposed (searchText, replacementText) pairs to results.jsonl.
// No file modification, no git, no VR — those are owned by the SaaS pillars.

export interface AcoCoreOptions {
  url: string
  projectDir: string   // Must contain aco.md; results.jsonl is written here
  conservative: boolean
  budget: BudgetConfig
}

export async function runAcoCore(options: AcoCoreOptions): Promise<void> {
  const { url, projectDir, conservative, budget } = options

  const program = await loadAcoConfig(projectDir)
  if (!program) throw new Error(`aco.md not found in ${projectDir}`)

  const allowedCategories: ChangeCategory[] = conservative
    ? ['copy', 'cta']
    : (program.constraints.allowedChangeCategories as ChangeCategory[])

  const runId = crypto.randomUUID()
  const resultsLogger = createResultsLogger(defaultLogPath(projectDir))

  // Observe
  const observation = await observePage(url)

  // Hypothesize
  const { audit, usage: hypoUsage } = await generateHypotheses(observation, program)
  let cumulativeCostUsd = hypoUsage.estimatedCostUsd

  const viableHypotheses = audit.hypotheses
    .filter(h => {
      const cat = EFFORT_TO_CATEGORY_MAP[h.effort] ?? 'structure'
      return allowedCategories.includes(cat as ChangeCategory)
    })
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99))
    .slice(0, budget.maxExperimentsPerRun ?? DEFAULT_BUDGET.maxExperimentsPerRun ?? 10)

  // Generate proposals and log them — SaaS applies via KV, not local files
  for (const hypothesis of viableHypotheses) {
    const experimentId = crypto.randomUUID()

    if (cumulativeCostUsd >= budget.maxUsd) break

    let generatorResult
    try {
      const htmlRes = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const pageHtml = await htmlRes.text()
      generatorResult = await generateChanges({
        hypothesis,
        pageHtml,
        programConfig: program,
        allowedCategories,
      })
      cumulativeCostUsd += generatorResult.usage.estimatedCostUsd
    } catch (err) {
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'error',
        reason: err instanceof Error ? err.message : String(err),
        costUsd: 0, cumulativeRunCostUsd: cumulativeCostUsd,
        provider: 'unknown', modelUsed: 'unknown',
      }))
      continue
    }

    if (generatorResult.skipped || generatorResult.changes.length === 0) {
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'skipped',
        reason: generatorResult.skipReason ?? 'No text changes generated',
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      continue
    }

    // Use the first change — one variant per experiment
    const change = generatorResult.changes[0]!
    const base = makeResult({
      experimentId, runId, hypothesis,
      outcome: 'accepted',
      reason: 'Proposal generated',
      costUsd: generatorResult.usage.estimatedCostUsd,
      cumulativeRunCostUsd: cumulativeCostUsd,
      provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
    })
    await resultsLogger.append({
      ...base,
      filePath: change.filePath,
      searchText: change.searchText,
      replacementText: change.replacementText,
    })
  }
}

// ─── Run command ──────────────────────────────────────────────────────────

export async function runAcoRun(urlArg: string | undefined, options: RunCommandOptions): Promise<void> {
  console.log()
  console.log(chalk.bold('⚡ ACO Run — Optimization Loop'))
  console.log()

  // ── 1. Setup ─────────────────────────────────────────────────────────────

  const program = await loadAcoConfig()
  if (!program) {
    console.error(chalk.red('\n  ✗ aco.md not found.\n'))
    console.error(chalk.dim('  Run aco init to create one, or change to the project directory.\n'))
    process.exit(1)
  }

  const targetUrl = urlArg ?? program.targetUrl
  if (!targetUrl) {
    console.error(chalk.red('\n  ✗ No URL provided.\n'))
    console.error(chalk.dim('  Usage: aco run https://localhost:3000\n'))
    process.exit(1)
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(targetUrl.startsWith('http') ? targetUrl : `http://${targetUrl}`)
  } catch {
    console.error(chalk.red(`\n  ✗ Invalid URL: "${targetUrl}"\n`))
    process.exit(1)
  }
  const url = parsedUrl.toString()

  let budget: BudgetConfig
  try {
    budget = parseBudget(options.budget, options.maxExperiments)
  } catch (err) {
    console.error(chalk.red(`\n  ✗ ${err instanceof Error ? err.message : String(err)}\n`))
    process.exit(1)
  }

  const allowedCategories: ChangeCategory[] = options.conservative
    ? ['copy', 'cta']
    : (program.constraints.allowedChangeCategories as ChangeCategory[])

  const projectDir = process.cwd()
  const runId = crypto.randomUUID()
  const resultsLogger = createResultsLogger(defaultLogPath(projectDir))
  const gitClient = createGitClient(projectDir)
  const screenshotDir = path.join(projectDir, '.aco', 'screenshots')

  console.log(chalk.dim(`  Brand: ${program.brand.name} · Goal: ${program.goals.primaryConversionGoal}`))
  console.log(chalk.dim(`  URL: ${url}`))
  console.log(chalk.dim(`  Budget: $${budget.maxUsd} · Max experiments: ${budget.maxExperimentsPerRun ?? DEFAULT_BUDGET.maxExperimentsPerRun}`))
  console.log(chalk.dim(`  Allowed categories: ${allowedCategories.join(', ')}`))
  if (options.dryRun) console.log(chalk.yellow('  DRY RUN — no files will be changed or committed'))
  console.log()

  // ── Git sanity check ──────────────────────────────────────────────────────

  if (!options.dryRun) {
    const spinnerGit = ora({ text: 'Checking git status…', prefixText: ' ' }).start()
    let clean: boolean
    try {
      clean = await gitClient.isClean()
    } catch (err) {
      spinnerGit.fail(chalk.red('Git check failed'))
      console.error(chalk.dim(`\n  ${err instanceof Error ? err.message : String(err)}\n`))
      console.error(chalk.dim('  aco run requires a clean git working tree to safely commit changes.\n'))
      process.exit(1)
    }

    if (!clean) {
      spinnerGit.fail(chalk.red('Working tree has uncommitted changes'))
      console.error(chalk.dim('\n  Commit or stash your changes before running aco run.\n'))
      console.error(chalk.dim('  git stash && aco run && git stash pop\n'))
      process.exit(1)
    }

    spinnerGit.succeed(chalk.green('Git working tree is clean'))
  }

  // ── 2. Observe (baseline) ────────────────────────────────────────────────

  const spinnerObserve = ora({ text: 'Capturing baseline…', prefixText: ' ' }).start()
  let observation
  try {
    observation = await observePage(url)
    spinnerObserve.succeed(chalk.green('Baseline captured') + chalk.dim(` · ${observation.dom.wordCount} words`))
  } catch (err) {
    spinnerObserve.fail(chalk.red('Failed to capture baseline'))
    console.error(chalk.dim(`\n  ${err instanceof Error ? err.message : String(err)}\n`))
    process.exit(1)
  }

  let baselineScreenshotPath = observation.screenshotPath

  // ── 3. Hypothesize ────────────────────────────────────────────────────────

  const spinnerHypo = ora({ text: 'Generating hypotheses…', prefixText: ' ' }).start()
  let hypotheses
  let hypothesisCost = 0
  let hypothesisProvider = 'unknown'
  try {
    const result = await generateHypotheses(observation, program)
    hypotheses = result.audit.hypotheses
    hypothesisCost = result.usage.estimatedCostUsd
    hypothesisProvider = 'anthropic'  // Will be from provider result in future
    spinnerHypo.succeed(
      chalk.green(`${hypotheses.length} hypotheses generated`) +
      chalk.dim(` · $${hypothesisCost.toFixed(4)}`)
    )
  } catch (err) {
    spinnerHypo.fail(chalk.red('Hypothesis generation failed'))
    console.error(chalk.dim(`\n  ${err instanceof Error ? err.message : String(err)}\n`))
    process.exit(1)
  }

  // Filter to allowed categories and sort by priority
  const EFFORT_TO_CATEGORY: Record<string, ChangeCategory> = {
    copy_only: 'copy',
    style_change: 'structure',
    layout_change: 'layout',
    structural_change: 'structure',
  }

  const viableHypotheses = hypotheses
    .filter(h => {
      const cat = EFFORT_TO_CATEGORY[h.effort] ?? 'structure'
      return allowedCategories.includes(cat)
    })
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99))
    .slice(0, budget.maxExperimentsPerRun ?? DEFAULT_BUDGET.maxExperimentsPerRun ?? 10)

  if (viableHypotheses.length === 0) {
    console.log(chalk.yellow('\n  No viable hypotheses in allowed categories. Try removing --conservative or updating aco.md.\n'))
    process.exit(0)
  }

  console.log(chalk.dim(`  Running ${viableHypotheses.length} viable hypotheses (filtered from ${hypotheses.length} total)`))
  console.log()

  // ── 4. Loop ───────────────────────────────────────────────────────────────

  let cumulativeCostUsd = hypothesisCost
  let accepted = 0
  let rejected = 0
  let skipped = 0
  let experimentCount = 0

  for (const hypothesis of viableHypotheses) {
    experimentCount++
    const experimentId = crypto.randomUUID()

    console.log(chalk.bold(`  [${hypothesis.id}] ${hypothesis.element}`))
    console.log(chalk.dim(`       ${hypothesis.recommendation.slice(0, 100)}`))

    // Budget check
    if (cumulativeCostUsd >= budget.maxUsd) {
      console.log(chalk.yellow(`\n  Budget cap reached ($${cumulativeCostUsd.toFixed(4)} / $${budget.maxUsd}). Stopping.\n`))
      break
    }
    if (budget.warnAtUsd && cumulativeCostUsd >= budget.warnAtUsd) {
      console.log(chalk.yellow(`  ⚠ Approaching budget limit ($${cumulativeCostUsd.toFixed(4)} / $${budget.maxUsd})`))
    }

    // Generate changes
    const spinnerGen = ora({ text: 'Generating code changes…', prefixText: '    ' }).start()
    let generatorResult
    try {
      // Fetch current page HTML from the dev server
      const htmlRes = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      const pageHtml = await htmlRes.text()

      generatorResult = await generateChanges({
        hypothesis,
        pageHtml,
        programConfig: program,
        allowedCategories,
      })
      cumulativeCostUsd += generatorResult.usage.estimatedCostUsd
      spinnerGen.succeed(chalk.green(`Changes generated`) + chalk.dim(` · $${generatorResult.usage.estimatedCostUsd.toFixed(4)} · ${generatorResult.modelUsed}`))
    } catch (err) {
      spinnerGen.fail(chalk.red('Change generation failed'))
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'error',
        reason: err instanceof Error ? err.message : String(err),
        costUsd: 0, cumulativeRunCostUsd: cumulativeCostUsd,
        provider: hypothesisProvider, modelUsed: 'unknown',
      }))
      rejected++
      console.log()
      continue
    }

    if (generatorResult.skipped || generatorResult.changes.length === 0) {
      console.log(chalk.dim(`    Skipped: ${generatorResult.skipReason ?? 'No implementable text changes found'}`))
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'skipped',
        reason: generatorResult.skipReason ?? 'No text changes generated',
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      skipped++
      console.log()
      continue
    }

    // Validate changes (ensure searchText exists exactly once in each file)
    const spinnerValidate = ora({ text: 'Validating changes…', prefixText: '    ' }).start()
    let allValid = true
    for (const change of generatorResult.changes) {
      try {
        const absPath = path.isAbsolute(change.filePath)
          ? change.filePath
          : path.join(projectDir, change.filePath)
        const content = await fs.readFile(absPath, 'utf-8')
        const validation = validateChangeSpec(change, content)
        if (!validation.valid) {
          spinnerValidate.fail(chalk.red(`Validation failed: ${validation.error}`))
          allValid = false
          break
        }
      } catch (err) {
        spinnerValidate.fail(chalk.red(`Cannot read file: ${change.filePath}`))
        allValid = false
        break
      }
    }

    if (!allValid) {
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'rejected',
        reason: 'Change validation failed — searchText not found or ambiguous',
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      rejected++
      console.log()
      continue
    }

    spinnerValidate.succeed(chalk.green(`${generatorResult.changes.length} change(s) validated`))

    // Show diff in dry-run mode
    if (options.dryRun) {
      for (const change of generatorResult.changes) {
        console.log(chalk.dim(`    File: ${change.filePath}`))
        console.log(chalk.red(`    - ${change.searchText.slice(0, 80)}`))
        console.log(chalk.green(`    + ${change.replacementText.slice(0, 80)}`))
      }
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'skipped',
        reason: 'dry-run',
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      skipped++
      console.log()
      continue
    }

    // Apply changes
    const spinnerApply = ora({ text: 'Applying changes…', prefixText: '    ' }).start()
    const changedFiles: string[] = []
    try {
      for (const change of generatorResult.changes) {
        await applyChange(projectDir, change.filePath, change.searchText, change.replacementText)
        changedFiles.push(change.filePath)
      }
      spinnerApply.succeed(chalk.green(`Applied ${changedFiles.length} change(s)`))
    } catch (err) {
      spinnerApply.fail(chalk.red('Failed to apply changes'))
      // Restore files that were already written
      if (changedFiles.length > 0) {
        await gitClient.restoreFiles(changedFiles).catch((restoreErr) => {
          console.warn(chalk.yellow(`\n  ⚠ Failed to restore modified files: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`))
          console.warn(chalk.dim(`    Run: git restore ${changedFiles.join(' ')}`))
        })
      }
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'error',
        reason: err instanceof Error ? err.message : String(err),
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      rejected++
      console.log()
      continue
    }

    // Wait for dev server rebuild
    const spinnerWait = ora({ text: 'Waiting for dev server rebuild…', prefixText: '    ' }).start()
    const serverReady = await waitForDevServer(url)
    if (!serverReady) {
      spinnerWait.fail(chalk.red('Dev server did not respond after 15s'))
      await gitClient.restoreFiles(changedFiles)
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'rejected',
        reason: 'Dev server timeout after applying changes',
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      rejected++
      console.log()
      continue
    }
    spinnerWait.succeed(chalk.green('Dev server ready'))

    // Visual regression
    const spinnerVR = ora({ text: 'Running visual regression check…', prefixText: '    ' }).start()
    let vrResult
    try {
      vrResult = await evaluateChange({
        url,
        beforeScreenshotPath: baselineScreenshotPath,
        screenshotDir,
        experimentId,
      })
    } catch (err) {
      spinnerVR.fail(chalk.red('Visual regression check failed'))
      await gitClient.restoreFiles(changedFiles)
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'error',
        reason: err instanceof Error ? err.message : String(err),
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      rejected++
      console.log()
      continue
    }

    if (!vrResult.passed) {
      spinnerVR.fail(
        chalk.red(`Visual regression failed`) +
        chalk.dim(` (similarity: ${(vrResult.similarityScore * 100).toFixed(1)}% < ${(vrResult.threshold * 100).toFixed(0)}% threshold)`)
      )
      if (vrResult.diffPath) console.log(chalk.dim(`    Diff image: ${vrResult.diffPath}`))
      await gitClient.restoreFiles(changedFiles)
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'rejected',
        reason: `Visual regression failed: ${(vrResult.similarityScore * 100).toFixed(1)}% similarity`,
        visualSimilarity: vrResult.similarityScore,
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      rejected++
      console.log()
      continue
    }

    spinnerVR.succeed(
      chalk.green(`Visual regression passed`) +
      chalk.dim(` (${(vrResult.similarityScore * 100).toFixed(2)}% similarity)`)
    )

    // Commit
    const spinnerCommit = ora({ text: 'Committing…', prefixText: '    ' }).start()
    let commitHash: string
    try {
      for (const fp of changedFiles) {
        await gitClient.stageFile(fp)
      }
      const commitMsg =
        `aco[${hypothesis.id}]: ${hypothesis.element} — ${hypothesis.principle}\n\n` +
        `Hypothesis: ${hypothesis.id} (${hypothesis.principle})\n` +
        `Category: ${EFFORT_TO_CATEGORY[hypothesis.effort] ?? 'copy'}\n` +
        `Recommendation: ${hypothesis.recommendation.slice(0, 200)}\n` +
        `Similarity score: ${vrResult.similarityScore.toFixed(4)}\n` +
        `Run: ${runId}  Experiment: ${experimentId}`

      commitHash = await gitClient.commit(commitMsg)
      spinnerCommit.succeed(chalk.green(`Committed`) + chalk.dim(` ${commitHash.slice(0, 8)}`))
    } catch (err) {
      spinnerCommit.fail(chalk.red('Git commit failed'))
      await gitClient.restoreFiles(changedFiles)
      await resultsLogger.append(makeResult({
        experimentId, runId, hypothesis,
        outcome: 'error',
        reason: err instanceof Error ? err.message : String(err),
        visualSimilarity: vrResult.similarityScore,
        costUsd: generatorResult.usage.estimatedCostUsd,
        cumulativeRunCostUsd: cumulativeCostUsd,
        provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
      }))
      rejected++
      console.log()
      continue
    }

    await resultsLogger.append(makeResult({
      experimentId, runId, hypothesis,
      outcome: 'accepted',
      reason: 'Visual regression passed, committed successfully',
      visualSimilarity: vrResult.similarityScore,
      gitCommitHash: commitHash,
      costUsd: generatorResult.usage.estimatedCostUsd,
      cumulativeRunCostUsd: cumulativeCostUsd,
      provider: generatorResult.provider, modelUsed: generatorResult.modelUsed,
    }))

    // Update baseline for next experiment
    baselineScreenshotPath = vrResult.afterPath
    accepted++
    console.log()
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────

  console.log(chalk.bold('━'.repeat(50)))
  console.log()
  console.log(chalk.bold('  Run complete'))
  console.log()
  console.log(
    `  ${chalk.green(`${accepted} accepted`)}  ` +
    `${chalk.red(`${rejected} rejected`)}  ` +
    `${chalk.dim(`${skipped} skipped`)}`
  )
  console.log(chalk.dim(`  Total cost: $${cumulativeCostUsd.toFixed(4)}`))
  console.log()
  if (accepted > 0) {
    console.log(chalk.dim('  Run aco status to see experiment history'))
    console.log(chalk.dim('  Run aco rollback to revert the last accepted change'))
  }
  console.log()
}

// ─── Helpers ──────────────────────────────────────────────────────────────

interface MakeResultOptions {
  experimentId: string
  runId: string
  hypothesis: { id: string; effort: string; element: string }
  outcome: ExperimentResult['outcome']
  reason: string
  visualSimilarity?: number
  gitCommitHash?: string
  costUsd: number
  cumulativeRunCostUsd: number
  provider: string
  modelUsed: string
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const EFFORT_TO_CATEGORY_MAP: Record<string, string> = {
  copy_only: 'copy',
  style_change: 'structure',
  layout_change: 'layout',
  structural_change: 'structure',
}

function makeResult(opts: MakeResultOptions): ExperimentResult {
  return {
    experimentId: opts.experimentId,
    runId: opts.runId,
    timestamp: new Date().toISOString(),
    hypothesisId: opts.hypothesis.id,
    category: (EFFORT_TO_CATEGORY_MAP[opts.hypothesis.effort] ?? 'copy') as ChangeCategory,
    filePath: '',
    searchText: '',
    replacementText: '',
    outcome: opts.outcome,
    reason: opts.reason,
    ...(opts.visualSimilarity !== undefined ? { visualSimilarity: opts.visualSimilarity } : {}),
    ...(opts.gitCommitHash !== undefined ? { gitCommitHash: opts.gitCommitHash } : {}),
    costUsd: opts.costUsd,
    cumulativeRunCostUsd: opts.cumulativeRunCostUsd,
    provider: opts.provider,
    modelUsed: opts.modelUsed,
  }
}
