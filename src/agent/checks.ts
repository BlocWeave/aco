import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const DEFAULT_QUALITY_CHECK_TIMEOUT_MS = 300_000
const OUTPUT_LIMIT = 8_000

export interface QualityCheckResult {
  configured: boolean
  passed: boolean
  timedOut: boolean
  exitCode: number | null
  output: string
  scriptPath: string
}

function appendOutput(current: string, chunk: Buffer | string): string {
  const combined = current + chunk.toString()
  return combined.length <= OUTPUT_LIMIT ? combined : combined.slice(-OUTPUT_LIMIT)
}

/**
 * Run optional project-owned verification after a generated change is applied.
 * The fixed script name keeps execution intentional and easy to audit.
 */
export async function runQualityChecks(
  projectDir: string,
  timeoutMs = DEFAULT_QUALITY_CHECK_TIMEOUT_MS,
): Promise<QualityCheckResult> {
  const scriptPath = path.join(projectDir, 'aco.checks.sh')

  try {
    await fs.access(scriptPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { configured: false, passed: true, timedOut: false, exitCode: null, output: '', scriptPath }
    }
    throw err
  }

  return new Promise(resolve => {
    const child = spawn('bash', [scriptPath], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let timedOut = false
    let settled = false
    let forceKillTimer: NodeJS.Timeout | undefined

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      resolve({
        configured: true,
        passed: !timedOut && exitCode === 0,
        timedOut,
        exitCode,
        output: output.trim(),
        scriptPath,
      })
    }

    child.stdout?.on('data', chunk => {
      output = appendOutput(output, chunk)
    })
    child.stderr?.on('data', chunk => {
      output = appendOutput(output, chunk)
    })
    child.once('error', err => {
      output = appendOutput(output, err.message)
      finish(null)
    })
    child.once('close', code => finish(code))

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000)
    }, timeoutMs)
  })
}
