#!/usr/bin/env node
import 'dotenv/config'
import { Command } from 'commander'
import chalk from 'chalk'
import { runAudit } from './commands/audit.js'
import { runInit } from './commands/init.js'
import { runAcoRun } from './commands/run.js'
import { runStatus } from './commands/status.js'
import { runRollback } from './commands/rollback.js'

const program = new Command()

program
  .name('aco')
  .description('Autonomous Conversion Optimizer — AI-powered CRO agent')
  .version('0.1.0', '-v, --version')
  .addHelpText('after', `
${chalk.bold('Examples:')}
  ${chalk.cyan('aco init')}                              Scaffold aco.md in current directory
  ${chalk.cyan('aco audit stripe.com')}                   Audit a page, generate report.html
  ${chalk.cyan('aco run http://localhost:3000')}           Run optimization loop against local dev server
  ${chalk.cyan('aco run --dry-run')}                      Preview what would change (no writes)
  ${chalk.cyan('aco run --conservative')}                 Copy/CTA changes only (safest mode)
  ${chalk.cyan('aco status')}                             Show experiment history and cost
  ${chalk.cyan('aco rollback')}                           Revert the last accepted change

${chalk.bold('Environment:')}
  ANTHROPIC_API_KEY    Claude API key — https://console.anthropic.com
  MIMO_API_KEY         MIMO proxy key (fallback when Anthropic credits run low)
  OPENAI_API_KEY       OpenAI key (final fallback)

${chalk.bold('Open source:')}
  https://github.com/aco-hq/aco · BSL-1.1 License
`)

// ── init ──────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Scaffold aco.md (Brand Soul) in the current directory')
  .action(async () => {
    await runInit()
  })

// ── audit ─────────────────────────────────────────────────────────────────

program
  .command('audit <url>')
  .description('Audit a landing page and generate a CRO report')
  .option('-o, --output <path>', 'Output file path (default: aco-report-<timestamp>.html)')
  .option('-m, --mobile', 'Capture on mobile viewport (390×844)', false)
  .option('-t, --timeout <seconds>', 'Page load timeout in seconds', '30')
  .action(async (url: string, options: { output?: string; mobile: boolean; timeout: string }) => {
    await runAudit(url, options)
  })

// ── run ───────────────────────────────────────────────────────────────────

program
  .command('run [url]')
  .description('Run the optimization loop against a local Next.js dev server')
  .option('--dry-run', 'Show what would change without modifying files or committing', false)
  .option('--conservative', 'Only make copy/CTA changes (safest mode)', false)
  .option('--budget <usd>', 'Max USD to spend on this run', '2.00')
  .option('--max-experiments <n>', 'Max experiments per run', '10')
  .option('--port <n>', 'Dev server port (overrides URL port)', '3000')
  .action(async (url: string | undefined, options: { dryRun: boolean; conservative: boolean; budget: string; maxExperiments: string; port: string }) => {
    await runAcoRun(url, options)
  })

// ── status ────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('Show experiment history and total cost from results.jsonl')
  .action(async () => {
    await runStatus()
  })

// ── rollback ──────────────────────────────────────────────────────────────

program
  .command('rollback [commitHash]')
  .description('Revert the last accepted change (or a specific commit by hash)')
  .option('-y, --yes', 'Skip confirmation prompt', false)
  .action(async (commitHash: string | undefined, options: { yes: boolean }) => {
    await runRollback({ ...(commitHash !== undefined ? { commitHash } : {}), yes: options.yes })
  })

// ── catch unknown commands ────────────────────────────────────────────────

program
  .on('command:*', (operands: string[]) => {
    console.error(chalk.red(`\n  Unknown command: ${operands[0]}\n`))
    console.log(`  Run ${chalk.cyan('aco --help')} to see available commands.`)
    console.log()
    process.exit(1)
  })

program.parse(process.argv)

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp()
}
