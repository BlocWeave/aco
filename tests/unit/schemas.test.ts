import { describe, it, expect } from 'vitest'
import {
  HypothesisSchema,
  AuditResponseSchema,
  CIALDINI_PRINCIPLES,
} from '../../src/types.js'
import { MOCK_HYPOTHESIS, MOCK_AUDIT_RESPONSE } from '../fixtures/index.js'

describe('HypothesisSchema', () => {
  it('accepts a valid hypothesis', () => {
    const result = HypothesisSchema.safeParse(MOCK_HYPOTHESIS)
    expect(result.success).toBe(true)
  })

  it('rejects an unknown principle', () => {
    const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, principle: 'dark_pattern' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid priority', () => {
    const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, priority: 'urgent' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid effort level', () => {
    const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, effort: 'magic' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid estimated_impact', () => {
    const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, estimated_impact: 'very_high' })
    expect(result.success).toBe(false)
  })

  it('requires all non-optional fields', () => {
    const required = ['id', 'principle', 'element', 'current_state', 'issue', 'recommendation', 'why_it_works', 'metric_to_track', 'priority', 'effort', 'estimated_impact']
    for (const field of required) {
      const incomplete = { ...MOCK_HYPOTHESIS } as Record<string, unknown>
      delete incomplete[field]
      const result = HypothesisSchema.safeParse(incomplete)
      expect(result.success, `Should fail when '${field}' is missing`).toBe(false)
    }
  })

  it('accepts all valid principles', () => {
    for (const principle of CIALDINI_PRINCIPLES) {
      const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, principle })
      expect(result.success, `Principle '${principle}' should be valid`).toBe(true)
    }
  })

  it('accepts all valid effort levels', () => {
    const efforts = ['copy_only', 'style_change', 'layout_change', 'structural_change'] as const
    for (const effort of efforts) {
      const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, effort })
      expect(result.success, `Effort '${effort}' should be valid`).toBe(true)
    }
  })

  it('accepts all valid priority levels', () => {
    const priorities = ['critical', 'high', 'medium', 'low'] as const
    for (const priority of priorities) {
      const result = HypothesisSchema.safeParse({ ...MOCK_HYPOTHESIS, priority })
      expect(result.success, `Priority '${priority}' should be valid`).toBe(true)
    }
  })
})

describe('AuditResponseSchema', () => {
  it('accepts a valid audit response', () => {
    const result = AuditResponseSchema.safeParse(MOCK_AUDIT_RESPONSE)
    expect(result.success).toBe(true)
  })

  it('requires at least 4 hypotheses', () => {
    const result = AuditResponseSchema.safeParse({
      ...MOCK_AUDIT_RESPONSE,
      hypotheses: MOCK_AUDIT_RESPONSE.hypotheses.slice(0, 3),
    })
    expect(result.success).toBe(false)
  })

  it('rejects more than 8 hypotheses', () => {
    const manyHypotheses = Array.from({ length: 9 }, (_, i) => ({
      ...MOCK_HYPOTHESIS,
      id: `H${String(i + 1).padStart(2, '0')}`,
    }))
    const result = AuditResponseSchema.safeParse({
      ...MOCK_AUDIT_RESPONSE,
      hypotheses: manyHypotheses,
    })
    expect(result.success).toBe(false)
  })

  it('rejects conversion scores outside 1–10', () => {
    const result = AuditResponseSchema.safeParse({
      ...MOCK_AUDIT_RESPONSE,
      conversion_score: { ...MOCK_AUDIT_RESPONSE.conversion_score, overall: 11 },
    })
    expect(result.success).toBe(false)

    const result2 = AuditResponseSchema.safeParse({
      ...MOCK_AUDIT_RESPONSE,
      conversion_score: { ...MOCK_AUDIT_RESPONSE.conversion_score, clarity: 0 },
    })
    expect(result2.success).toBe(false)
  })

  it('accepts scores at the boundaries (1 and 10)', () => {
    const result = AuditResponseSchema.safeParse({
      ...MOCK_AUDIT_RESPONSE,
      conversion_score: { overall: 1, clarity: 10, trust: 1, urgency: 10, social_proof: 1 },
    })
    expect(result.success).toBe(true)
  })

  it('requires all five score dimensions', () => {
    const dimensions = ['overall', 'clarity', 'trust', 'urgency', 'social_proof']
    for (const dim of dimensions) {
      const incompleteScore = { ...MOCK_AUDIT_RESPONSE.conversion_score } as Record<string, unknown>
      delete incompleteScore[dim]
      const result = AuditResponseSchema.safeParse({
        ...MOCK_AUDIT_RESPONSE,
        conversion_score: incompleteScore,
      })
      expect(result.success, `Should fail when score '${dim}' is missing`).toBe(false)
    }
  })

  it('requires overall_assessment, top_finding, quick_wins, what_is_working', () => {
    const topLevelFields = ['overall_assessment', 'top_finding', 'quick_wins', 'what_is_working', 'hypotheses', 'conversion_score']
    for (const field of topLevelFields) {
      const incomplete = { ...MOCK_AUDIT_RESPONSE } as Record<string, unknown>
      delete incomplete[field]
      const result = AuditResponseSchema.safeParse(incomplete)
      expect(result.success, `Should fail when '${field}' is missing`).toBe(false)
    }
  })

  it('parsed data passes through exactly', () => {
    const result = AuditResponseSchema.safeParse(MOCK_AUDIT_RESPONSE)
    if (!result.success) throw new Error('Unexpected validation failure')
    expect(result.data.overall_assessment).toBe(MOCK_AUDIT_RESPONSE.overall_assessment)
    expect(result.data.conversion_score.overall).toBe(5)
    expect(result.data.hypotheses).toHaveLength(4)
  })
})
