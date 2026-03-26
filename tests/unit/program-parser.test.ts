import { describe, it, expect } from 'vitest'
import { parseAcoMd, DEFAULT_CONFIG } from '../../src/config/program.js'

const FULL_PROGRAM_MD = `---
brand:
  name: Acme SaaS
  tagline: The fastest workflow platform
  tone: clear, direct, confident
  audience: B2B SaaS founders
  value_proposition: Cut setup from weeks to hours

goals:
  primary: get visitors to sign up for a free trial
  url: https://acmesaas.com

constraints:
  voice: Write like a knowledgeable engineer
  allowed_categories:
    - copy
    - cta
    - social_proof
  never_change:
    - do not change the pricing table
    - never alter legal text
---

# Brand Soul — Acme SaaS

## Who We Are
We help engineering teams automate workflows.
`

const MINIMAL_FRONTMATTER = `---
brand:
  name: Minimal Brand
goals:
  primary: sign up for newsletter
---
`

const NO_FRONTMATTER = `# My Brand

Goal: get visitors to book a demo
URL: https://mybrand.com/demo
`

describe('parseAcoMd', () => {
  describe('with full frontmatter', () => {
    it('parses brand name', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.brand.name).toBe('Acme SaaS')
    })

    it('parses brand tone', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.brand.tone).toBe('clear, direct, confident')
    })

    it('parses brand audience', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.brand.audience).toBe('B2B SaaS founders')
    })

    it('parses brand value_proposition', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.brand.valueProposition).toBe('Cut setup from weeks to hours')
    })

    it('parses primary conversion goal', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.goals.primaryConversionGoal).toBe('get visitors to sign up for a free trial')
    })

    it('parses target URL', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.targetUrl).toBe('https://acmesaas.com')
    })

    it('parses brand voice', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.constraints.brandVoice).toBe('Write like a knowledgeable engineer')
    })

    it('parses never-change constraints as array', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.constraints.thingsToNeverChange).toBeDefined()
      expect(config.constraints.thingsToNeverChange?.length).toBeGreaterThanOrEqual(2)
      expect(config.constraints.thingsToNeverChange).toContain('do not change the pricing table')
      expect(config.constraints.thingsToNeverChange).toContain('never alter legal text')
    })

    it('includes allowed_categories from defaults', () => {
      const config = parseAcoMd(FULL_PROGRAM_MD)
      expect(config.constraints.allowedChangeCategories).toContain('copy')
      expect(config.constraints.allowedChangeCategories).toContain('cta')
    })
  })

  describe('with minimal frontmatter', () => {
    it('parses brand name', () => {
      const config = parseAcoMd(MINIMAL_FRONTMATTER)
      expect(config.brand.name).toBe('Minimal Brand')
    })

    it('falls back to defaults for missing fields', () => {
      const config = parseAcoMd(MINIMAL_FRONTMATTER)
      // Default allowed categories should still be present
      expect(config.constraints.allowedChangeCategories.length).toBeGreaterThan(0)
    })

    it('does not crash on missing optional fields', () => {
      const config = parseAcoMd(MINIMAL_FRONTMATTER)
      expect(config.brand.tone).toBeUndefined()
      expect(config.brand.audience).toBeUndefined()
      expect(config.targetUrl).toBeUndefined()
    })
  })

  describe('without frontmatter (markdown fallback)', () => {
    it('extracts brand name from H1', () => {
      const config = parseAcoMd(NO_FRONTMATTER)
      expect(config.brand.name).toBe('My Brand')
    })

    it('extracts primary goal from Goal: line', () => {
      const config = parseAcoMd(NO_FRONTMATTER)
      expect(config.goals.primaryConversionGoal).toBe('get visitors to book a demo')
    })

    it('extracts target URL from URL: line', () => {
      const config = parseAcoMd(NO_FRONTMATTER)
      expect(config.targetUrl).toBe('https://mybrand.com/demo')
    })
  })

  describe('edge cases', () => {
    it('handles empty string without throwing', () => {
      const config = parseAcoMd('')
      expect(config).toBeDefined()
      expect(config.constraints.allowedChangeCategories).toBeDefined()
    })

    it('handles only whitespace without throwing', () => {
      const config = parseAcoMd('   \n\n   ')
      expect(config).toBeDefined()
    })

    it('handles frontmatter with no body without throwing', () => {
      const config = parseAcoMd('---\nbrand:\n  name: Solo\n---\n')
      expect(config.brand.name).toBe('Solo')
    })

    it('does not mutate DEFAULT_CONFIG', () => {
      parseAcoMd(FULL_PROGRAM_MD)
      // Default config brand name should remain 'Unknown'
      expect(DEFAULT_CONFIG.brand.name).toBe('Unknown')
    })
  })
})
