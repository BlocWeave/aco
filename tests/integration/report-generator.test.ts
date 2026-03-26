import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { generateReport } from '../../src/report/generator.js'
import { MOCK_AUDIT_RESPONSE, MOCK_PAGE_OBSERVATION } from '../fixtures/index.js'
import type { TokenUsage } from '../../src/integrations/claude.js'

const MOCK_USAGE: TokenUsage = {
  inputTokens: 2_800,
  outputTokens: 1_200,
  totalTokens: 4_000,
  estimatedCostUsd: 0.0264,
}

let tmpDir: string
let reportPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aco-test-'))
  reportPath = path.join(tmpDir, 'test-report.html')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('generateReport', () => {
  it('writes a file to the specified path', async () => {
    await generateReport({ observation: MOCK_PAGE_OBSERVATION, audit: MOCK_AUDIT_RESPONSE, usage: MOCK_USAGE }, reportPath)
    const exists = await fs.access(reportPath).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('returns the path of the written file', async () => {
    const returned = await generateReport({ observation: MOCK_PAGE_OBSERVATION, audit: MOCK_AUDIT_RESPONSE, usage: MOCK_USAGE }, reportPath)
    expect(returned).toBe(reportPath)
  })

  describe('HTML structure', () => {
    let html: string
    beforeEach(async () => {
      await generateReport({ observation: MOCK_PAGE_OBSERVATION, audit: MOCK_AUDIT_RESPONSE, usage: MOCK_USAGE }, reportPath)
      html = await fs.readFile(reportPath, 'utf-8')
    })

    it('is a valid HTML document with doctype and html tags', () => {
      expect(html).toMatch(/^<!DOCTYPE html>/i)
      expect(html).toContain('<html')
      expect(html).toContain('</html>')
      expect(html).toContain('<head')
      expect(html).toContain('<body')
    })

    it('has a UTF-8 charset meta tag', () => {
      expect(html).toContain('charset="UTF-8"')
    })

    it('has a viewport meta tag for mobile', () => {
      expect(html).toContain('name="viewport"')
    })

    it('has a meaningful title tag', () => {
      expect(html).toContain('<title>')
      expect(html).toMatch(/<title>.*ACO.*<\/title>/i)
    })

    it('is self-contained — no external stylesheet or script links', () => {
      // Should not link external CSS
      expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="http/i)
      // Should not load external scripts
      expect(html).not.toMatch(/<script[^>]+src="http/i)
    })

    it('embeds the screenshot as a base64 data URI', () => {
      expect(html).toContain('data:image/png;base64,')
    })
  })

  describe('content accuracy', () => {
    let html: string
    beforeEach(async () => {
      await generateReport({ observation: MOCK_PAGE_OBSERVATION, audit: MOCK_AUDIT_RESPONSE, usage: MOCK_USAGE }, reportPath)
      html = await fs.readFile(reportPath, 'utf-8')
    })

    it('includes the page URL', () => {
      expect(html).toContain('https://example.com')
    })

    it('includes the overall score', () => {
      expect(html).toContain('5')   // overall score from fixture
    })

    it('includes the top finding', () => {
      expect(html).toContain(MOCK_AUDIT_RESPONSE.top_finding.slice(0, 40))
    })

    it('includes all hypothesis IDs', () => {
      for (const h of MOCK_AUDIT_RESPONSE.hypotheses) {
        expect(html).toContain(h.id)
      }
    })

    it('includes all Cialdini principle labels for present hypotheses', () => {
      // social_proof hypothesis should render "Social Proof" label
      expect(html).toContain('Social Proof')
      // clarity hypothesis should render "Clarity" label
      expect(html).toContain('Clarity')
    })

    it('includes all quick wins', () => {
      for (const win of MOCK_AUDIT_RESPONSE.quick_wins) {
        // Slice to first special HTML char so we compare against plain text that
        // appears verbatim in the HTML (before any escaping kicks in).
        const safeSlice = win.replace(/[&<>"']/g, '|').split('|')[0] ?? win.slice(0, 20)
        if (safeSlice.length >= 8) {
          expect(html).toContain(safeSlice)
        }
      }
    })

    it('includes what_is_working items', () => {
      for (const good of MOCK_AUDIT_RESPONSE.what_is_working) {
        expect(html).toContain(good.slice(0, 30))
      }
    })

    it('includes accessibility issues', () => {
      expect(html).toContain('Accessibility Issues')
      expect(html).toContain('missing_alt'.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    })

    it('includes token usage and cost in the footer', () => {
      expect(html).toContain('4,000')       // total tokens
      expect(html).toContain('0.0264')       // cost
    })

    it('includes the OSS disclaimer', () => {
      expect(html).toContain('hypotheses')
      expect(html).toContain('A/B tests')
    })
  })

  describe('XSS safety — user-supplied content is escaped', () => {
    it('escapes XSS payloads in page title', async () => {
      const maliciousObservation = {
        ...MOCK_PAGE_OBSERVATION,
        title: '<script>alert("xss")</script>',
      }
      await generateReport({
        observation: maliciousObservation,
        audit: MOCK_AUDIT_RESPONSE,
        usage: MOCK_USAGE,
      }, reportPath)
      const html = await fs.readFile(reportPath, 'utf-8')
      expect(html).not.toContain('<script>alert("xss")</script>')
      expect(html).toContain('&lt;script&gt;')
    })

    it('escapes XSS payloads in hypothesis recommendation', async () => {
      const maliciousAudit = {
        ...MOCK_AUDIT_RESPONSE,
        hypotheses: [{
          ...MOCK_AUDIT_RESPONSE.hypotheses[0]!,
          recommendation: '" onmouseover="alert(1)',
        }, ...MOCK_AUDIT_RESPONSE.hypotheses.slice(1)],
      }
      await generateReport({
        observation: MOCK_PAGE_OBSERVATION,
        audit: maliciousAudit,
        usage: MOCK_USAGE,
      }, reportPath)
      const html = await fs.readFile(reportPath, 'utf-8')
      expect(html).not.toContain('" onmouseover="alert(1)')
      expect(html).toContain('&quot;')
    })

    it('escapes XSS payloads in top_finding', async () => {
      const maliciousAudit = {
        ...MOCK_AUDIT_RESPONSE,
        top_finding: "<img src=x onerror='alert(1)'>",
      }
      await generateReport({
        observation: MOCK_PAGE_OBSERVATION,
        audit: maliciousAudit,
        usage: MOCK_USAGE,
      }, reportPath)
      const html = await fs.readFile(reportPath, 'utf-8')
      expect(html).not.toContain("<img src=x onerror='alert(1)'>")
      expect(html).toContain('&lt;img')
    })
  })

  describe('score rendering', () => {
    it('renders a low score with red colour', async () => {
      const lowScoreAudit = {
        ...MOCK_AUDIT_RESPONSE,
        conversion_score: { overall: 2, clarity: 2, trust: 2, urgency: 2, social_proof: 2 },
      }
      await generateReport({ observation: MOCK_PAGE_OBSERVATION, audit: lowScoreAudit, usage: MOCK_USAGE }, reportPath)
      const html = await fs.readFile(reportPath, 'utf-8')
      expect(html).toContain('#ef4444')   // red for low scores
    })

    it('renders a high score with green colour', async () => {
      const highScoreAudit = {
        ...MOCK_AUDIT_RESPONSE,
        conversion_score: { overall: 8, clarity: 8, trust: 8, urgency: 8, social_proof: 8 },
      }
      await generateReport({ observation: MOCK_PAGE_OBSERVATION, audit: highScoreAudit, usage: MOCK_USAGE }, reportPath)
      const html = await fs.readFile(reportPath, 'utf-8')
      expect(html).toContain('#22c55e')   // green for high scores
    })
  })
})
