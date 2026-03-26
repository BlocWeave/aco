import { chromium } from 'playwright'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import sharp from 'sharp'

// ─── Types ────────────────────────────────────────────────────────────────

export interface VisualRegressionResult {
  similarityScore: number    // 0.0 – 1.0 (1.0 = pixel-identical)
  passed: boolean
  threshold: number
  beforePath: string
  afterPath: string
  diffPath: string | null
}

export interface EvaluatorOptions {
  url: string
  beforeScreenshotPath: string
  screenshotDir: string
  experimentId: string
  threshold?: number         // Default 0.85
  viewport?: { width: number; height: number }
}

// ─── Screenshot capture ───────────────────────────────────────────────────

export async function takeScreenshot(url: string, outputPath: string, viewport = { width: 1440, height: 900 }): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewportSize(viewport)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
    await page.screenshot({ path: outputPath, fullPage: false })
  } finally {
    await browser.close()
  }
}

// ─── Pixel similarity ─────────────────────────────────────────────────────
// Compares two PNG files pixel-by-pixel using raw RGBA buffers via sharp.
// Returns similarity score 0.0–1.0 and optionally writes a diff image.

async function computePixelSimilarity(
  beforePath: string,
  afterPath: string,
  diffPath: string | null
): Promise<number> {
  const [beforeMeta, afterMeta] = await Promise.all([
    sharp(beforePath).metadata(),
    sharp(afterPath).metadata(),
  ])

  const width = beforeMeta.width ?? 0
  const height = beforeMeta.height ?? 0

  // Resize after to match before if viewport sizes somehow differ
  const [beforeRaw, afterRaw] = await Promise.all([
    sharp(beforePath).resize(width, height).raw().toBuffer(),
    sharp(afterPath).resize(width, height).raw().toBuffer(),
  ])

  const channels = 3  // RGB (sharp raw() for PNGs without alpha gives 3 channels)
  const totalPixels = width * height

  let totalChannelDiff = 0
  let diffPixels = 0
  const diffBuffer: Buffer | null = diffPath ? Buffer.alloc(totalPixels * channels) : null

  for (let i = 0; i < totalPixels; i++) {
    const base = i * channels
    const r1 = beforeRaw[base] ?? 0
    const g1 = beforeRaw[base + 1] ?? 0
    const b1 = beforeRaw[base + 2] ?? 0
    const r2 = afterRaw[base] ?? 0
    const g2 = afterRaw[base + 1] ?? 0
    const b2 = afterRaw[base + 2] ?? 0

    const diff = (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / (3 * 255)
    totalChannelDiff += diff

    if (diffBuffer) {
      const isDifferent = diff > 0.05
      if (isDifferent) diffPixels++
      // Diff image: red where pixels differ, dark gray where identical
      diffBuffer[base] = isDifferent ? 220 : 40
      diffBuffer[base + 1] = isDifferent ? 30 : 40
      diffBuffer[base + 2] = isDifferent ? 30 : 40
    }
  }

  void diffPixels  // Used only for logging if needed

  if (diffBuffer && diffPath) {
    await sharp(diffBuffer, { raw: { width, height, channels } })
      .png()
      .toFile(diffPath)
  }

  return 1 - (totalChannelDiff / totalPixels)
}

// ─── Main evaluator ───────────────────────────────────────────────────────

export async function evaluateChange(options: EvaluatorOptions): Promise<VisualRegressionResult> {
  const {
    url,
    beforeScreenshotPath,
    screenshotDir,
    experimentId,
    threshold = 0.85,
    viewport = { width: 1440, height: 900 },
  } = options

  await fs.mkdir(screenshotDir, { recursive: true })

  const afterPath = path.join(screenshotDir, `after-${experimentId}.png`)

  // Capture the "after" state
  await takeScreenshot(url, afterPath, viewport)

  // Run pixel comparison
  const diffPath = path.join(screenshotDir, `diff-${experimentId}.png`)
  const similarityScore = await computePixelSimilarity(beforeScreenshotPath, afterPath, diffPath)

  const passed = similarityScore >= threshold

  // Only keep diff image if the test failed (saves disk space)
  if (passed) {
    await fs.unlink(diffPath).catch(() => {/* ok if already gone */})
  }

  return {
    similarityScore,
    passed,
    threshold,
    beforePath: beforeScreenshotPath,
    afterPath,
    diffPath: passed ? null : diffPath,
  }
}
