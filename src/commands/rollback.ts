import chalk from 'chalk'
import * as crypto from 'node:crypto'
import * as readline from 'node:readline/promises'
import { createGitClient } from '../integrations/git.js'
import { createResultsLogger, defaultLogPath } from '../logger/results.js'
import type { ExperimentResult } from '../types.js'

export interface RollbackOptions {
  commitHash?: string
  yes?: boolean  // Skip confirmation prompt (--yes flag)
}

export async function runRollback(opts: RollbackOptions): Promise<void> {
  const projectDir = process.cwd()
  const logger = createResultsLogger(defaultLogPath(projectDir))
  const git = createGitClient(projectDir)

  console.log()
  console.log(chalk.bold('⚡ ACO Rollback'))
  console.log()

  // Find the commit to revert
  let targetHash: string
  let targetResult: ExperimentResult | null = null

  if (opts.commitHash) {
    targetHash = opts.commitHash
    console.log(`  Reverting commit: ${chalk.cyan(targetHash.slice(0, 8))}`)
  } else {
    targetResult = await logger.getLastAccepted()
    if (!targetResult?.gitCommitHash) {
      console.error(chalk.red('  ✗ No accepted experiments found to roll back.\n'))
      console.error(chalk.dim('  Check aco status for experiment history.\n'))
      process.exit(1)
    }
    targetHash = targetResult.gitCommitHash
    console.log(`  Last accepted: ${chalk.cyan(targetHash.slice(0, 8))}`)
    console.log(`  Hypothesis:    ${targetResult.hypothesisId}`)
    console.log(`  File:          ${chalk.dim(targetResult.filePath || '(not recorded)')}`)
  }

  console.log()

  // Confirmation prompt (unless --yes)
  if (!opts.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let answer: string
    try {
      answer = await rl.question(`  Revert commit ${targetHash.slice(0, 8)}? (y/N) `)
    } finally {
      rl.close()
    }

    if (answer.trim().toLowerCase() !== 'y') {
      console.log(chalk.dim('\n  Rollback cancelled.\n'))
      process.exit(0)
    }
  }

  // Perform revert
  try {
    await git.revertCommit(targetHash)
    console.log()
    console.log(chalk.green(`  ✓ Reverted commit ${targetHash.slice(0, 8)} — a new revert commit was created.`))
  } catch (err) {
    console.error()
    console.error(chalk.red(`  ✗ Revert failed: ${err instanceof Error ? err.message : String(err)}`))
    process.exit(1)
  }

  // Log the revert in results.jsonl
  if (targetResult) {
    await logger.append({
      ...targetResult,
      experimentId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      outcome: 'reverted',
      reason: `Manual rollback of ${targetHash.slice(0, 8)}`,
      gitCommitHash: undefined,
    })
  }

  console.log()
  console.log(chalk.dim('  Run aco status to see updated experiment history.'))
  console.log()
}
