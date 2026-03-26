import chalk from 'chalk'
import { createResultsLogger, defaultLogPath } from '../logger/results.js'

export async function runStatus(): Promise<void> {
  const projectDir = process.cwd()
  const logPath = defaultLogPath(projectDir)
  const logger = createResultsLogger(logPath)

  const all = await logger.readAll()

  console.log()
  console.log(chalk.bold('⚡ ACO Status'))
  console.log()

  if (all.length === 0) {
    console.log(chalk.dim('  No experiments recorded yet.'))
    console.log(chalk.dim('  Run aco run <url> to start the optimization loop.'))
    console.log()
    return
  }

  // All-time summary
  const accepted = all.filter(r => r.outcome === 'accepted')
  const rejected = all.filter(r => r.outcome === 'rejected')
  const skipped = all.filter(r => r.outcome === 'skipped')
  const errors = all.filter(r => r.outcome === 'error')
  const totalCost = all.reduce((sum, r) => sum + r.costUsd, 0)

  console.log(chalk.bold('  All-time totals'))
  console.log(
    `    ${chalk.green(`${accepted.length} accepted`)}  ` +
    `${chalk.red(`${rejected.length} rejected`)}  ` +
    `${chalk.dim(`${skipped.length} skipped`)}  ` +
    `${errors.length > 0 ? chalk.red(`${errors.length} errors`) + '  ' : ''}` +
    chalk.dim(`$${totalCost.toFixed(4)} total cost`)
  )
  console.log()

  // Recent accepted experiments
  if (accepted.length > 0) {
    console.log(chalk.bold('  Accepted changes (most recent first)'))
    const recent = [...accepted].reverse().slice(0, 5)
    for (const r of recent) {
      const hash = r.gitCommitHash ? chalk.dim(` ${r.gitCommitHash.slice(0, 8)}`) : ''
      const date = new Date(r.timestamp).toLocaleString()
      console.log(
        `    ${chalk.green('✓')} ${r.hypothesisId}${hash} ` +
        chalk.dim(`· ${r.filePath || 'no file'} · ${date}`)
      )
      if (r.reason && r.reason !== 'Visual regression passed, committed successfully') {
        console.log(chalk.dim(`      ${r.reason.slice(0, 80)}`))
      }
    }
    if (accepted.length > 5) {
      console.log(chalk.dim(`    ... and ${accepted.length - 5} more`))
    }
    console.log()
  }

  // Last accepted (for rollback reference)
  const lastAccepted = await logger.getLastAccepted()
  if (lastAccepted?.gitCommitHash) {
    console.log(chalk.bold('  Last accepted commit'))
    console.log(`    Commit: ${chalk.cyan(lastAccepted.gitCommitHash.slice(0, 8))}`)
    console.log(`    Hypothesis: ${lastAccepted.hypothesisId}`)
    console.log(`    File: ${chalk.dim(lastAccepted.filePath || '(not recorded)')}`)
    console.log()
    console.log(chalk.dim(`  To revert: aco rollback`))
  }

  console.log()
}
