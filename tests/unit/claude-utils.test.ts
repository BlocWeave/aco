import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { calculateCost, zodToJsonSchema, MODELS } from '../../src/integrations/claude.js'

// ─── calculateCost ────────────────────────────────────────────────────────

describe('calculateCost', () => {
  it('returns 0 for zero tokens', () => {
    expect(calculateCost(MODELS.fast, 0, 0)).toBe(0)
    expect(calculateCost(MODELS.quality, 0, 0)).toBe(0)
  })

  it('calculates haiku cost correctly', () => {
    // claude-haiku: $0.80 input / $4.00 output per million tokens
    const cost = calculateCost(MODELS.fast, 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(0.80 + 4.00, 5)
  })

  it('calculates sonnet cost correctly', () => {
    // claude-sonnet: $3.00 input / $15.00 output per million tokens
    const cost = calculateCost(MODELS.quality, 1_000_000, 1_000_000)
    expect(cost).toBeCloseTo(3.00 + 15.00, 5)
  })

  it('scales linearly with token count', () => {
    const half = calculateCost(MODELS.quality, 500_000, 500_000)
    const full = calculateCost(MODELS.quality, 1_000_000, 1_000_000)
    expect(full).toBeCloseTo(half * 2, 5)
  })

  it('charges input and output independently', () => {
    const inputOnly = calculateCost(MODELS.quality, 1_000_000, 0)
    const outputOnly = calculateCost(MODELS.quality, 0, 1_000_000)
    expect(inputOnly).toBeCloseTo(3.00, 5)
    expect(outputOnly).toBeCloseTo(15.00, 5)
  })

  it('uses fallback pricing for unknown models', () => {
    // Unknown model should use sonnet pricing as fallback
    const unknown = calculateCost('claude-unknown-model', 1_000_000, 1_000_000)
    const sonnet = calculateCost(MODELS.quality, 1_000_000, 1_000_000)
    expect(unknown).toBe(sonnet)
  })

  it('a typical audit costs under $0.20', () => {
    // Typical audit: ~3000 input tokens, ~1500 output tokens
    const cost = calculateCost(MODELS.quality, 3_000, 1_500)
    expect(cost).toBeLessThan(0.20)
  })
})

// ─── zodToJsonSchema ──────────────────────────────────────────────────────

describe('zodToJsonSchema', () => {
  describe('ZodString', () => {
    it('converts to { type: "string" }', () => {
      const schema = zodToJsonSchema(z.string())
      expect(schema).toEqual({ type: 'string' })
    })

    it('includes description when present', () => {
      const schema = zodToJsonSchema(z.string().describe('The element to target'))
      expect(schema).toMatchObject({ type: 'string', description: 'The element to target' })
    })
  })

  describe('ZodNumber', () => {
    it('converts to { type: "number" }', () => {
      const schema = zodToJsonSchema(z.number())
      expect(schema).toEqual({ type: 'number' })
    })

    it('includes minimum constraint', () => {
      const schema = zodToJsonSchema(z.number().min(1))
      expect(schema).toMatchObject({ type: 'number', minimum: 1 })
    })

    it('includes maximum constraint', () => {
      const schema = zodToJsonSchema(z.number().max(10))
      expect(schema).toMatchObject({ type: 'number', maximum: 10 })
    })

    it('includes both min and max', () => {
      const schema = zodToJsonSchema(z.number().min(1).max(10))
      expect(schema).toMatchObject({ type: 'number', minimum: 1, maximum: 10 })
    })
  })

  describe('ZodBoolean', () => {
    it('converts to { type: "boolean" }', () => {
      const schema = zodToJsonSchema(z.boolean())
      expect(schema).toEqual({ type: 'boolean' })
    })
  })

  describe('ZodEnum', () => {
    it('converts to { type: "string", enum: [...] }', () => {
      const schema = zodToJsonSchema(z.enum(['a', 'b', 'c']))
      expect(schema).toEqual({ type: 'string', enum: ['a', 'b', 'c'] })
    })

    it('preserves all enum values', () => {
      const values = ['critical', 'high', 'medium', 'low'] as const
      const schema = zodToJsonSchema(z.enum(values)) as { enum: string[] }
      expect(schema.enum).toHaveLength(4)
      expect(schema.enum).toContain('critical')
      expect(schema.enum).toContain('low')
    })
  })

  describe('ZodArray', () => {
    it('converts to { type: "array", items: ... }', () => {
      const schema = zodToJsonSchema(z.array(z.string()))
      expect(schema).toMatchObject({ type: 'array', items: { type: 'string' } })
    })

    it('includes minItems when set', () => {
      const schema = zodToJsonSchema(z.array(z.string()).min(4))
      expect(schema).toMatchObject({ type: 'array', minItems: 4 })
    })

    it('includes maxItems when set', () => {
      const schema = zodToJsonSchema(z.array(z.string()).max(8))
      expect(schema).toMatchObject({ type: 'array', maxItems: 8 })
    })

    it('handles array of objects', () => {
      const schema = zodToJsonSchema(z.array(z.object({ id: z.string() })))
      expect(schema).toMatchObject({
        type: 'array',
        items: { type: 'object' },
      })
    })
  })

  describe('ZodObject', () => {
    it('converts to { type: "object", properties: {...}, required: [...] }', () => {
      const schema = zodToJsonSchema(z.object({ name: z.string(), age: z.number() }))
      expect(schema).toMatchObject({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: expect.arrayContaining(['name', 'age']),
      })
    })

    it('excludes optional fields from required array', () => {
      const schema = zodToJsonSchema(z.object({
        required: z.string(),
        optional: z.string().optional(),
      })) as { required: string[] }
      expect(schema.required).toContain('required')
      expect(schema.required).not.toContain('optional')
    })

    it('handles nested objects', () => {
      const schema = zodToJsonSchema(z.object({
        meta: z.object({ score: z.number() }),
      }))
      expect(schema).toMatchObject({
        type: 'object',
        properties: {
          meta: { type: 'object', properties: { score: { type: 'number' } } },
        },
      })
    })

    it('produces valid schema for HypothesisSchema', async () => {
      // The real schema used in production — if this breaks, tool_use breaks
      const { HypothesisSchema } = await import('../../src/types.js')
      const schema = zodToJsonSchema(HypothesisSchema) as {
        type: string
        properties: Record<string, unknown>
        required: string[]
      }
      expect(schema.type).toBe('object')
      expect(schema.properties).toHaveProperty('principle')
      expect(schema.properties).toHaveProperty('recommendation')
      expect(schema.required).toContain('principle')
      expect(schema.required).toContain('recommendation')
    })
  })

  describe('ZodOptional', () => {
    it('unwraps to the inner type schema', () => {
      const schema = zodToJsonSchema(z.string().optional())
      expect(schema).toEqual({ type: 'string' })
    })
  })
})
