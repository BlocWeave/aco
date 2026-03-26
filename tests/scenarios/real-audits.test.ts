/**
 * Scenario tests — run the full audit pipeline against real websites.
 *
 * These tests use the real Anthropic API (reads ANTHROPIC_API_KEY from .env)
 * and real Playwright browser. They're deliberately excluded from `npm test`.
 * Run with: npm run test:scenarios
 *
 * What they validate beyond unit tests:
 *   1. The full pipeline works end-to-end without crashing
 *   2. Claude returns structurally valid output for real pages
 *   3. Our honesty constraint is enforced — no fake percentage predictions
 *   4. Hypothesis quality: reasoning is substantive, not generic
 *   5. Each site's report is saved to disk and is a valid, non-trivial HTML file
 *   6. Cost tracking works against a real API response
 */

import 'dotenv/config'
import { describe, it, expect, beforeAll } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { observePage } from '../../src/agent/observer.js'
import { generateHypotheses } from '../../src/agent/hypothesizer.js'
import { generateReport } from '../../src/report/generator.js'
import { initProviders } from '../../src/integrations/providers.js'
import { AuditResponseSchema } from '../../src/types.js'
import type { PageObservation, AuditResponse } from '../../src/types.js'
import type { TokenUsage } from '../../src/integrations/claude.js'

// ─── Config ───────────────────────────────────────────────────────────────

const REPORTS_DIR = path.resolve('reports')

const SITES = [
  {
    name: 'Relaytt',
    url: 'https://relaytt.com',
    reportFile: 'relaytt-report.html',
    expectations: {
      // What we expect a CRO agent to notice about this site
      likelyPrinciples: ['social_proof', 'clarity', 'trust', 'commitment'],
    },
  },
  {
    name: 'MediaReduce',
    url: 'https://mediareduce.com',
    reportFile: 'mediareduce-report.html',
    expectations: {
      likelyPrinciples: ['clarity', 'social_proof', 'authority', 'commitment'],
    },
  },
  {
    name: 'Ghana House Planner',
    url: 'https://ghanahouseplanner.com',
    reportFile: 'ghanahouseplanner-report.html',
    expectations: {
      likelyPrinciples: ['trust', 'social_proof', 'clarity', 'authority'],
    },
  },
] as const

// ─── Shared audit runner ──────────────────────────────────────────────────

interface AuditResult {
  site: typeof SITES[number]
  observation: PageObservation
  audit: AuditResponse
  usage: TokenUsage
  reportPath: string
  durationMs: number
}

async function runAuditForSite(site: typeof SITES[number]): Promise<AuditResult> {
  const t0 = Date.now()
  const observation = await observePage(site.url)
  const { audit, usage } = await generateHypotheses(observation)
  const reportPath = path.join(REPORTS_DIR, site.reportFile)
  await generateReport({ observation, audit, usage }, reportPath)
  return { site, observation, audit, usage, reportPath, durationMs: Date.now() - t0 }
}

// ─── Suite ────────────────────────────────────────────────────────────────

describe('Real-world audit scenarios', () => {
  beforeAll(async () => {
    // Eagerly init so the registry is populated before any test runs (avoids
    // the race condition from ensureInitialised()'s fire-and-forget imports).
    await initProviders()
    await fs.mkdir(REPORTS_DIR, { recursive: true })
  })

  // Run each site as an independent describe block so failures are isolated
  for (const site of SITES) {
    describe(`${site.name} (${site.url})`, () => {
      let result: AuditResult

      beforeAll(async () => {
        result = await runAuditForSite(site)
        console.log(`\n  ✓ ${site.name} — ${result.durationMs}ms · $${result.usage.estimatedCostUsd.toFixed(4)} · ${result.usage.totalTokens} tokens`)
      })

      // ── Pipeline health ─────────────────────────────────────────────────

      it('completes without error', () => {
        expect(result).toBeDefined()
        expect(result.audit).toBeDefined()
      })

      it('saves a non-trivial HTML report to disk', async () => {
        const stat = await fs.stat(result.reportPath)
        // A minimal valid report with one hypothesis is >5KB; real reports >20KB
        expect(stat.size).toBeGreaterThan(5_000)
        const html = await fs.readFile(result.reportPath, 'utf-8')
        expect(html).toMatch(/^<!DOCTYPE html>/i)
        expect(html).toContain('</html>')
      })

      // ── Schema validity ─────────────────────────────────────────────────

      it('returns a structurally valid audit response', () => {
        const parsed = AuditResponseSchema.safeParse(result.audit)
        if (!parsed.success) {
          // Surface the full Zod error for debugging
          console.error(parsed.error.toString())
        }
        expect(parsed.success).toBe(true)
      })

      it('returns 4–8 hypotheses', () => {
        expect(result.audit.hypotheses.length).toBeGreaterThanOrEqual(4)
        expect(result.audit.hypotheses.length).toBeLessThanOrEqual(8)
      })

      it('assigns sequential IDs starting at H01', () => {
        result.audit.hypotheses.forEach((h, i) => {
          expect(h.id).toBe(`H${String(i + 1).padStart(2, '0')}`)
        })
      })

      // ── Scores ──────────────────────────────────────────────────────────

      it('has scores in the valid 1–10 range', () => {
        const s = result.audit.conversion_score
        for (const [key, val] of Object.entries(s)) {
          expect(val, `Score '${key}' out of range: ${val}`).toBeGreaterThanOrEqual(1)
          expect(val, `Score '${key}' out of range: ${val}`).toBeLessThanOrEqual(10)
        }
      })

      it('does not give a suspiciously generous overall score (>8) for an unvalidated page', () => {
        // A score >8 on first audit of an unknown site suggests the agent is being
        // sycophantic rather than honest. Real pages almost always have room to improve.
        expect(result.audit.conversion_score.overall).toBeLessThanOrEqual(8)
      })

      // ── Honesty constraint ───────────────────────────────────────────────
      // CRITICAL: ACO must never claim specific conversion lift percentages.
      // Fake numbers are the #1 credibility killer (see Gap 4 in ACO_MASTER_ANALYSIS.md).

      it('does not claim specific conversion lift percentages in any hypothesis', () => {
        // Match patterns like "23% lift", "increase by 15%", "+34%", "improve conversions by 20%"
        const fakePercentPattern = /(\d+)\s*%\s*(lift|increase|improvement|boost|gain|better|more)/i
        const claimsPercentages = /(\+\d+%|up to \d+%|\d+% (more|better|higher|improvement))/i

        for (const h of result.audit.hypotheses) {
          const allText = [h.issue, h.recommendation, h.why_it_works].join(' ')
          expect(allText, `H${h.id} contains a fake percentage prediction`).not.toMatch(fakePercentPattern)
          expect(allText, `H${h.id} contains a fake percentage claim`).not.toMatch(claimsPercentages)
        }
      })

      it('uses relative impact levels (high/medium/low) not percentages', () => {
        for (const h of result.audit.hypotheses) {
          expect(['high', 'medium', 'low']).toContain(h.estimated_impact)
        }
      })

      // ── Hypothesis quality ───────────────────────────────────────────────

      it('each hypothesis names a valid Cialdini principle', () => {
        const VALID_PRINCIPLES = ['reciprocity', 'commitment', 'social_proof', 'authority', 'scarcity', 'urgency', 'liking', 'unity', 'clarity', 'trust']
        for (const h of result.audit.hypotheses) {
          expect(VALID_PRINCIPLES, `Unknown principle: ${h.principle}`).toContain(h.principle)
        }
      })

      it('each hypothesis has substantive (non-trivial) text fields', () => {
        for (const h of result.audit.hypotheses) {
          expect(h.issue.length, `H${h.id}.issue is too short`).toBeGreaterThan(30)
          expect(h.recommendation.length, `H${h.id}.recommendation is too short`).toBeGreaterThan(30)
          expect(h.why_it_works.length, `H${h.id}.why_it_works is too short`).toBeGreaterThan(30)
          expect(h.metric_to_track.length, `H${h.id}.metric_to_track is too short`).toBeGreaterThan(10)
        }
      })

      it('top_finding is a substantive observation (>50 chars)', () => {
        expect(result.audit.top_finding.length).toBeGreaterThan(50)
      })

      it('overall_assessment is substantive (>80 chars)', () => {
        expect(result.audit.overall_assessment.length).toBeGreaterThan(80)
      })

      it('provides at least 2 quick wins', () => {
        expect(result.audit.quick_wins.length).toBeGreaterThanOrEqual(2)
        for (const win of result.audit.quick_wins) {
          expect(win.length).toBeGreaterThan(20)
        }
      })

      it('provides at least 1 "what is working" observation', () => {
        expect(result.audit.what_is_working.length).toBeGreaterThanOrEqual(1)
        for (const good of result.audit.what_is_working) {
          expect(good.length).toBeGreaterThan(15)
        }
      })

      it('includes at least one expected principle for this type of site', () => {
        const principles = result.audit.hypotheses.map(h => h.principle)
        const hasExpected = site.expectations.likelyPrinciples.some(p => principles.includes(p))
        expect(hasExpected, `None of expected principles [${site.expectations.likelyPrinciples.join(', ')}] found. Got: [${principles.join(', ')}]`).toBe(true)
      })

      // ── Cost sanity ──────────────────────────────────────────────────────

      it('tracks token usage greater than zero', () => {
        expect(result.usage.inputTokens).toBeGreaterThan(0)
        expect(result.usage.outputTokens).toBeGreaterThan(0)
        expect(result.usage.totalTokens).toBe(result.usage.inputTokens + result.usage.outputTokens)
      })

      it('costs less than $0.50 per audit', () => {
        expect(result.usage.estimatedCostUsd).toBeLessThan(0.50)
        expect(result.usage.estimatedCostUsd).toBeGreaterThan(0)
      })

      // ── Observation quality ──────────────────────────────────────────────

      it('captured a non-empty screenshot', () => {
        expect(result.observation.screenshotBase64.length).toBeGreaterThan(500)
      })

      it('captured a page title', () => {
        expect(result.observation.title.length).toBeGreaterThan(0)
      })

      it('extracted at least one CTA', () => {
        expect(result.observation.dom.ctaText.length).toBeGreaterThan(0)
      })

      it('HTML report embeds the screenshot', async () => {
        const html = await fs.readFile(result.reportPath, 'utf-8')
        expect(html).toContain('data:image/png;base64,')
      })

      it('HTML report contains the correct site URL', async () => {
        const html = await fs.readFile(result.reportPath, 'utf-8')
        expect(html).toContain(site.url.replace('https://', ''))
      })
    })
  }
})
