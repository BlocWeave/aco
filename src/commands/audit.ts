import chalk from 'chalk'
import ora from 'ora'
import * as path from 'node:path'
import { observePage } from '../agent/observer.js'
import { generateHypotheses } from '../agent/hypothesizer.js'
import { generateReport } from '../report/generator.js'
import { loadAcoConfig } from '../config/program.js'

export interface AuditOptions {
  output?: string
  mobile?: boolean
  timeout?: string
  noScreenshot?: boolean
}

export async function runAudit(url: string, options: AuditOptions): Promise<void> {
  // Validate URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`)
  } catch {
    console.error(chalk.red(`\n✗ Invalid URL: "${url}"\n  Example: aco audit stripe.com\n`))
    process.exit(1)
  }

  const targetUrl = parsedUrl.toString()
  const timeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : 30_000

  console.log()
  console.log(chalk.bold('⚡ ACO Audit'))
  console.log(chalk.gray(`   ${targetUrl}`))
  console.log()

  // Load aco.md if present (optional)
  const program = await loadAcoConfig()
  if (program?.brand.name && program.brand.name !== 'Unknown') {
    console.log(chalk.dim(`   Brand context: ${program.brand.name} · ${program.goals.primaryConversionGoal}`))
    console.log()
  }

  // Step 1: Observe
  const spinnerObserve = ora({
    text: 'Capturing page…',
    color: 'blue',
    prefixText: ' ',
  }).start()

  let observation
  try {
    observation = await observePage(targetUrl, {
      mobile: options.mobile ?? false,
      timeoutMs,
    })
    spinnerObserve.succeed(chalk.green(`Page captured`) + chalk.dim(` · ${observation.dom.wordCount} words · ${observation.accessibility.length} a11y issues`))
  } catch (err) {
    spinnerObserve.fail(chalk.red('Failed to load page'))
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('net::ERR_NAME_NOT_RESOLVED')) {
      console.error(chalk.dim(`\n  Could not reach ${targetUrl}\n  Check the URL and your internet connection.\n`))
    } else if (message.includes('Timeout')) {
      console.error(chalk.dim(`\n  Page took too long to load (${timeoutMs / 1000}s timeout).\n  Try: aco audit ${url} --timeout 60\n`))
    } else {
      console.error(chalk.dim(`\n  ${message}\n`))
    }
    process.exit(1)
  }

  // Step 2: Analyze with Claude
  const spinnerAnalyze = ora({
    text: 'Analyzing with Claude…',
    color: 'blue',
    prefixText: ' ',
  }).start()

  let auditResult
  try {
    auditResult = await generateHypotheses(observation, program)
    const { audit, usage } = auditResult
    const hypothesisCount = audit.hypotheses.length
    const critical = audit.hypotheses.filter(h => h.priority === 'critical').length
    spinnerAnalyze.succeed(
      chalk.green(`Analysis complete`) +
      chalk.dim(` · ${hypothesisCount} hypotheses · ${critical > 0 ? chalk.yellow(`${critical} critical`) : '0 critical'} · $${usage.estimatedCostUsd.toFixed(4)}`)
    )
  } catch (err) {
    spinnerAnalyze.fail(chalk.red('Analysis failed'))
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('ANTHROPIC_API_KEY')) {
      console.error(chalk.dim('\n  ' + message + '\n'))
    } else {
      console.error(chalk.dim(`\n  ${message}\n`))
    }
    process.exit(1)
  }

  // Step 3: Generate report
  const spinnerReport = ora({
    text: 'Generating report…',
    color: 'blue',
    prefixText: ' ',
  }).start()

  const outputPath = options.output
    ? path.resolve(process.cwd(), options.output)
    : path.join(process.cwd(), `aco-report-${Date.now()}.html`)

  let reportPath: string
  try {
    reportPath = await generateReport({
      observation,
      audit: auditResult.audit,
      usage: auditResult.usage,
    }, outputPath)
    spinnerReport.succeed(chalk.green('Report generated'))
  } catch (err) {
    spinnerReport.fail(chalk.red('Report generation failed'))
    console.error(chalk.dim(`\n  ${err instanceof Error ? err.message : String(err)}\n`))
    process.exit(1)
  }

  // Summary
  console.log()
  console.log(chalk.bold('━'.repeat(50)))
  console.log()
  console.log(
    `  Overall score: ` +
    scoreLabel(auditResult.audit.conversion_score.overall) +
    chalk.dim(` · Clarity ${auditResult.audit.conversion_score.clarity} · Trust ${auditResult.audit.conversion_score.trust} · Social Proof ${auditResult.audit.conversion_score.social_proof}`)
  )
  console.log()
  console.log(`  ${chalk.bold.yellow('🎯 Top finding:')} ${auditResult.audit.top_finding}`)
  console.log()
  console.log(`  ${chalk.bold('Hypotheses by priority:')}`)
  const byPriority = ['critical', 'high', 'medium', 'low'] as const
  for (const p of byPriority) {
    const count = auditResult.audit.hypotheses.filter(h => h.priority === p).length
    if (count > 0) {
      const color = p === 'critical' ? chalk.red : p === 'high' ? chalk.yellow : p === 'medium' ? chalk.cyan : chalk.dim
      console.log(`    ${color(`${count} ${p}`)}`)
    }
  }
  console.log()
  console.log(`  ${chalk.bold('⚡ Quick wins:')}`)
  auditResult.audit.quick_wins.slice(0, 3).forEach((w, i) => {
    console.log(chalk.dim(`    ${i + 1}. ${w}`))
  })
  console.log()
  console.log(chalk.bold('━'.repeat(50)))
  console.log()
  console.log(`  Report saved: ${chalk.cyan(reportPath)}`)
  console.log()
  console.log(chalk.dim('  Open in your browser: ') + chalk.cyan(`open ${reportPath}`))
  console.log()
}

function scoreLabel(score: number): string {
  if (score >= 8) return chalk.bold.green(`${score}/10`)
  if (score >= 6) return chalk.bold.yellow(`${score}/10`)
  return chalk.bold.red(`${score}/10`)
}
