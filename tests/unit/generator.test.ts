import { describe, it, expect } from 'vitest'
import { extractRelevantHtml, buildGeneratorPrompt, validateChangeSpec } from '../../src/agent/generator.js'
import type { Hypothesis, AcoConfig } from '../../src/types.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────

const MOCK_HYPOTHESIS: Hypothesis = {
  id: 'H01',
  principle: 'clarity',
  element: 'hero CTA button',
  current_state: 'Button says "Get Started"',
  issue: 'Generic CTA creates commitment anxiety',
  recommendation: 'Change CTA to "Start Your Free Trial" to set clear expectations',
  why_it_works: 'Specificity reduces ambiguity and commitment anxiety (Cialdini: commitment)',
  metric_to_track: 'Click-through rate on primary CTA',
  priority: 'high',
  effort: 'copy_only',
  estimated_impact: 'high',
}

const MOCK_PROGRAM: AcoConfig = {
  brand: {
    name: 'TestCo',
    tone: 'friendly and direct',
    valueProposition: 'Save 10 hours per week',
  },
  goals: { primaryConversionGoal: 'start free trial' },
  constraints: {
    allowedChangeCategories: ['copy', 'cta'],
    thingsToNeverChange: ['pricing', 'legal text'],
  },
}

// ─── extractRelevantHtml ──────────────────────────────────────────────────

describe('extractRelevantHtml', () => {
  it('returns the first 12000 chars when the element text is not found', () => {
    const html = 'x'.repeat(20_000)
    const result = extractRelevantHtml(html, 'completely absent text')
    expect(result).toHaveLength(12_000)
    expect(result).toBe(html.slice(0, 12_000))
  })

  it('returns a window centered around the found keyword', () => {
    const prefix = 'A'.repeat(5_000)
    const marker = '<button>Get Started</button>'
    const suffix = 'Z'.repeat(5_000)
    const html = prefix + marker + suffix

    const result = extractRelevantHtml(html, 'button')
    // The result should contain the marker text
    expect(result).toContain('Get Started')
  })

  it('handles HTML shorter than the window without throwing', () => {
    const html = '<h1>Hello</h1>'
    const result = extractRelevantHtml(html, 'hello')
    expect(result).toBeTruthy()
    expect(result.length).toBeLessThanOrEqual(12_000)
  })

  it('uses partial keyword match for short element descriptions', () => {
    const html = '<div class="hero"><button>Start</button></div>'
    const result = extractRelevantHtml(html, 'hero')
    expect(result).toContain('hero')
  })
})

// ─── buildGeneratorPrompt ─────────────────────────────────────────────────

describe('buildGeneratorPrompt', () => {
  const baseInput = {
    hypothesis: MOCK_HYPOTHESIS,
    pageHtml: '<h1>Hello</h1><button>Get Started</button>',
    programConfig: MOCK_PROGRAM,
    allowedCategories: ['copy', 'cta'] as const,
  }

  it('includes the hypothesis ID', () => {
    const prompt = buildGeneratorPrompt({ ...baseInput, allowedCategories: ['copy', 'cta'] })
    expect(prompt).toContain('H01')
  })

  it('includes the hypothesis recommendation', () => {
    const prompt = buildGeneratorPrompt({ ...baseInput, allowedCategories: ['copy', 'cta'] })
    expect(prompt).toContain('Start Your Free Trial')
  })

  it('includes allowed categories', () => {
    const prompt = buildGeneratorPrompt({ ...baseInput, allowedCategories: ['copy', 'cta'] })
    expect(prompt).toContain('copy')
    expect(prompt).toContain('cta')
  })

  it('includes brand name and tone', () => {
    const prompt = buildGeneratorPrompt({ ...baseInput, allowedCategories: ['copy', 'cta'] })
    expect(prompt).toContain('TestCo')
    expect(prompt).toContain('friendly and direct')
  })

  it('includes things to never change', () => {
    const prompt = buildGeneratorPrompt({ ...baseInput, allowedCategories: ['copy', 'cta'] })
    expect(prompt).toContain('pricing')
    expect(prompt).toContain('legal text')
  })

  it('truncates HTML to 12000 chars', () => {
    const bigHtml = 'x'.repeat(20_000)
    const prompt = buildGeneratorPrompt({ ...baseInput, pageHtml: bigHtml, allowedCategories: ['copy', 'cta'] })
    // The prompt itself may be larger but the embedded HTML section should be capped
    const htmlStart = prompt.indexOf('```html\n') + 8
    const htmlEnd = prompt.indexOf('\n```', htmlStart)
    const embeddedHtml = prompt.slice(htmlStart, htmlEnd)
    expect(embeddedHtml.length).toBeLessThanOrEqual(12_000)
  })

  it('shows (none specified) when thingsToNeverChange is empty', () => {
    const noConstraints: AcoConfig = {
      ...MOCK_PROGRAM,
      constraints: { allowedChangeCategories: ['copy'] },
    }
    const prompt = buildGeneratorPrompt({ ...baseInput, programConfig: noConstraints, allowedCategories: ['copy'] })
    expect(prompt).toContain('(none specified)')
  })
})

// ─── validateChangeSpec ───────────────────────────────────────────────────

describe('validateChangeSpec', () => {
  const baseSpec = {
    hypothesisId: 'H01',
    category: 'copy' as const,
    filePath: 'app/page.tsx',
    description: 'Change CTA text',
    searchText: 'Get Started Today',
    replacementText: 'Start Your Free Trial',
    reasoning: 'Specificity reduces commitment anxiety',
  }

  it('returns valid: true when searchText appears exactly once', () => {
    const content = '<button>Get Started Today</button>'
    const result = validateChangeSpec(baseSpec, content)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('returns valid: false with error when searchText is not found', () => {
    const content = '<button>Click Here</button>'
    const result = validateChangeSpec(baseSpec, content)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns valid: false with count when searchText appears multiple times', () => {
    const content = '<button>Get Started Today</button><span>Get Started Today</span>'
    const result = validateChangeSpec(baseSpec, content)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('2 times')
  })

  it('handles multiline searchText correctly', () => {
    const searchText = 'line one\nline two'
    const spec = { ...baseSpec, searchText }
    const content = `before\nline one\nline two\nafter`
    expect(validateChangeSpec(spec, content).valid).toBe(true)
  })

  it('handles empty file content', () => {
    const result = validateChangeSpec(baseSpec, '')
    expect(result.valid).toBe(false)
  })
})
