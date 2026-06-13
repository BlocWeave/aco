import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runQualityChecks } from '../../src/agent/checks.js'

describe('runQualityChecks', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aco-checks-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('does nothing when aco.checks.sh is not configured', async () => {
    const result = await runQualityChecks(tmpDir)

    expect(result.configured).toBe(false)
    expect(result.passed).toBe(true)
  })

  it('passes when the configured script exits successfully', async () => {
    await fs.writeFile(path.join(tmpDir, 'aco.checks.sh'), 'echo "all good"\nexit 0\n', 'utf-8')

    const result = await runQualityChecks(tmpDir)

    expect(result.configured).toBe(true)
    expect(result.passed).toBe(true)
    expect(result.output).toContain('all good')
  })

  it('captures output when the configured script fails', async () => {
    await fs.writeFile(path.join(tmpDir, 'aco.checks.sh'), 'echo "typecheck failed" >&2\nexit 2\n', 'utf-8')

    const result = await runQualityChecks(tmpDir)

    expect(result.passed).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(result.output).toContain('typecheck failed')
  })

  it('terminates a configured script after its timeout', async () => {
    await fs.writeFile(path.join(tmpDir, 'aco.checks.sh'), 'exec sleep 10\n', 'utf-8')

    const result = await runQualityChecks(tmpDir, 20)

    expect(result.passed).toBe(false)
    expect(result.timedOut).toBe(true)
  })
})
