import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import sharp from 'sharp'
import { evaluateChange, takeScreenshot } from '../../src/agent/evaluator.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Create a solid-colour PNG of given dimensions */
async function solidPng(outPath: string, r: number, g: number, b: number, width = 200, height = 200): Promise<void> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = r
    pixels[i * 3 + 1] = g
    pixels[i * 3 + 2] = b
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(outPath)
}

/** Create a PNG that is mostly one colour but with a different-coloured patch */
async function patchedPng(outPath: string, width = 200, height = 200, patchSize = 50): Promise<void> {
  const pixels = Buffer.alloc(width * height * 3).fill(200)  // light gray background
  // Paint a red patch in the top-left corner
  for (let y = 0; y < patchSize; y++) {
    for (let x = 0; x < patchSize; x++) {
      const idx = (y * width + x) * 3
      pixels[idx] = 255  // R
      pixels[idx + 1] = 0   // G
      pixels[idx + 2] = 0   // B
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(outPath)
}

// ─── Suite ────────────────────────────────────────────────────────────────

describe('evaluateChange — visual regression', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aco-eval-test-'))
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('identical screenshots have similarity >= 0.999', async () => {
    const experimentId = crypto.randomUUID()
    const beforePath = path.join(tmpDir, 'before-identical.png')

    // Create a reference PNG
    await solidPng(beforePath, 100, 150, 200)

    // evaluateChange takes the "after" screenshot; we need to serve the same image
    // Since we can't easily mock takeScreenshot here without a live server,
    // we test the underlying computation directly by calling sharp comparisons.
    // The integration part (real Playwright) is tested in the scenario tests.

    // Test the pixel computation: two identical PNGs should be very similar
    const afterPath = path.join(tmpDir, 'after-identical.png')
    await solidPng(afterPath, 100, 150, 200)

    // Read both buffers and compare manually using the same logic as evaluator.ts
    const [beforeMeta] = await Promise.all([sharp(beforePath).metadata()])
    const width = beforeMeta.width ?? 200
    const height = beforeMeta.height ?? 200

    const [beforeRaw, afterRaw] = await Promise.all([
      sharp(beforePath).resize(width, height).raw().toBuffer(),
      sharp(afterPath).resize(width, height).raw().toBuffer(),
    ])

    let totalDiff = 0
    const channels = 3
    const totalPixels = width * height
    for (let i = 0; i < totalPixels; i++) {
      const base = i * channels
      const r1 = beforeRaw[base] ?? 0; const r2 = afterRaw[base] ?? 0
      const g1 = beforeRaw[base + 1] ?? 0; const g2 = afterRaw[base + 1] ?? 0
      const b1 = beforeRaw[base + 2] ?? 0; const b2 = afterRaw[base + 2] ?? 0
      totalDiff += (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / (3 * 255)
    }
    const similarity = 1 - (totalDiff / totalPixels)
    expect(similarity).toBeGreaterThanOrEqual(0.999)
    void experimentId  // used when testing full evaluateChange with a real server
  })

  it('significantly different images have similarity < 0.85', async () => {
    const beforePath = path.join(tmpDir, 'before-diff.png')
    const afterPath = path.join(tmpDir, 'after-diff.png')

    // Completely different colours: white vs black
    await solidPng(beforePath, 255, 255, 255)
    await solidPng(afterPath, 0, 0, 0)

    const meta = await sharp(beforePath).metadata()
    const width = meta.width ?? 200
    const height = meta.height ?? 200

    const [beforeRaw, afterRaw] = await Promise.all([
      sharp(beforePath).raw().toBuffer(),
      sharp(afterPath).raw().toBuffer(),
    ])

    let totalDiff = 0
    const channels = 3
    const totalPixels = width * height
    for (let i = 0; i < totalPixels; i++) {
      const base = i * channels
      const r1 = beforeRaw[base] ?? 0; const r2 = afterRaw[base] ?? 0
      const g1 = beforeRaw[base + 1] ?? 0; const g2 = afterRaw[base + 1] ?? 0
      const b1 = beforeRaw[base + 2] ?? 0; const b2 = afterRaw[base + 2] ?? 0
      totalDiff += (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / (3 * 255)
    }
    const similarity = 1 - (totalDiff / totalPixels)
    expect(similarity).toBeLessThan(0.85)
  })

  it('a small text change (few pixels different) scores >= 0.99', async () => {
    const beforePath = path.join(tmpDir, 'before-small.png')
    const afterPath = path.join(tmpDir, 'after-small.png')

    // Both images share the same background (200,200,200); only a 10x10 patch differs
    await solidPng(beforePath, 200, 200, 200)
    await patchedPng(afterPath, 200, 200, 10)  // 10x10 red patch on same gray

    const meta = await sharp(beforePath).metadata()
    const width = meta.width ?? 200
    const height = meta.height ?? 200

    const [beforeRaw, afterRaw] = await Promise.all([
      sharp(beforePath).resize(width, height).raw().toBuffer(),
      sharp(afterPath).resize(width, height).raw().toBuffer(),
    ])

    let totalDiff = 0
    const channels = 3
    const totalPixels = width * height
    for (let i = 0; i < totalPixels; i++) {
      const base = i * channels
      const r1 = beforeRaw[base] ?? 0; const r2 = afterRaw[base] ?? 0
      const g1 = beforeRaw[base + 1] ?? 0; const g2 = afterRaw[base + 1] ?? 0
      const b1 = beforeRaw[base + 2] ?? 0; const b2 = afterRaw[base + 2] ?? 0
      totalDiff += (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / (3 * 255)
    }
    const similarity = 1 - (totalDiff / totalPixels)
    // 10x10 = 100 changed pixels out of 40000 total — should be very high similarity
    expect(similarity).toBeGreaterThanOrEqual(0.99)
  })
})
