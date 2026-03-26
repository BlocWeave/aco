import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MOCK_PAGE_OBSERVATION, MOCK_AUDIT_RESPONSE } from '../fixtures/index.js'

// ─── Mock the provider layer ──────────────────────────────────────────────
// We mock callWithFallback so tests never hit the real API.
// This lets us verify: prompt construction, ID assignment, schema validation,
// and error handling — without real network calls or API keys.

vi.mock('../../src/integrations/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/integrations/providers.js')>()
  return {
    ...actual,
    callWithFallback: vi.fn(),
  }
})

const MOCK_RESULT = {
  result: MOCK_AUDIT_RESPONSE,
  usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, estimatedCostUsd: 0.012 },
  provider: 'anthropic' as const,
  modelUsed: 'claude-sonnet-4-6',
}

describe('generateHypotheses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('assigns H01, H02, … IDs to hypotheses in order', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue(MOCK_RESULT)

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    const { audit } = await generateHypotheses(MOCK_PAGE_OBSERVATION)

    expect(audit.hypotheses[0]?.id).toBe('H01')
    expect(audit.hypotheses[1]?.id).toBe('H02')
    expect(audit.hypotheses[2]?.id).toBe('H03')
    expect(audit.hypotheses[3]?.id).toBe('H04')
  })

  it('returns token usage from the provider', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue({
      ...MOCK_RESULT,
      usage: { inputTokens: 2000, outputTokens: 800, totalTokens: 2800, estimatedCostUsd: 0.018 },
    })

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    const { usage } = await generateHypotheses(MOCK_PAGE_OBSERVATION)

    expect(usage.inputTokens).toBe(2000)
    expect(usage.outputTokens).toBe(800)
    expect(usage.totalTokens).toBe(2800)
    expect(usage.estimatedCostUsd).toBeCloseTo(0.018, 5)
  })

  it('passes the screenshot as a base64 image in the message', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue(MOCK_RESULT)

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    await generateHypotheses(MOCK_PAGE_OBSERVATION)

    const [call] = vi.mocked(callWithFallback).mock.calls
    expect(call).toBeDefined()
    const messages = call![0].messages
    const firstMessage = messages[0]
    expect(firstMessage?.role).toBe('user')

    // The content should be an array with an image block
    const content = firstMessage?.content
    expect(Array.isArray(content)).toBe(true)
    if (Array.isArray(content)) {
      const imageBlock = content.find((c: { type: string }) => c.type === 'image')
      expect(imageBlock).toBeDefined()
      const block = imageBlock as { type: string; source: { type: string; media_type: string; data: string } }
      expect(block.source.type).toBe('base64')
      expect(block.source.media_type).toBe('image/png')
      expect(block.source.data).toBe(MOCK_PAGE_OBSERVATION.screenshotBase64)
    }
  })

  it('includes page URL in the text message content', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue(MOCK_RESULT)

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    await generateHypotheses(MOCK_PAGE_OBSERVATION)

    const [call] = vi.mocked(callWithFallback).mock.calls
    const messages = call![0].messages
    const textBlock = (messages[0]?.content as Array<{ type: string; text?: string }>)
      ?.find(c => c.type === 'text')
    expect(textBlock?.text).toContain('https://example.com')
  })

  it('includes brand context from aco.md when provided', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue(MOCK_RESULT)

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    const program = {
      brand: { name: 'TestCo', valueProposition: 'Save 10 hours a week' },
      goals: { primaryConversionGoal: 'start free trial' },
      constraints: { allowedChangeCategories: ['copy' as const] },
    }
    await generateHypotheses(MOCK_PAGE_OBSERVATION, program)

    const [call] = vi.mocked(callWithFallback).mock.calls
    const messages = call![0].messages
    const textBlock = (messages[0]?.content as Array<{ type: string; text?: string }>)
      ?.find(c => c.type === 'text')
    expect(textBlock?.text).toContain('TestCo')
    expect(textBlock?.text).toContain('start free trial')
  })

  it('uses the quality model tier', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue(MOCK_RESULT)

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    await generateHypotheses(MOCK_PAGE_OBSERVATION)

    const [call] = vi.mocked(callWithFallback).mock.calls
    expect(call![0].modelTier).toBe('quality')
  })

  it('throws when the provider returns an error', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockRejectedValue(new Error('Rate limit exceeded'))

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    await expect(generateHypotheses(MOCK_PAGE_OBSERVATION)).rejects.toThrow('Rate limit exceeded')
  })

  it('preserves all hypotheses from the provider response', async () => {
    const { callWithFallback } = await import('../../src/integrations/providers.js')
    vi.mocked(callWithFallback).mockResolvedValue(MOCK_RESULT)

    const { generateHypotheses } = await import('../../src/agent/hypothesizer.js')
    const { audit } = await generateHypotheses(MOCK_PAGE_OBSERVATION)

    expect(audit.hypotheses).toHaveLength(MOCK_AUDIT_RESPONSE.hypotheses.length)
    // Non-ID fields should be unchanged
    expect(audit.hypotheses[0]?.principle).toBe(MOCK_AUDIT_RESPONSE.hypotheses[0]?.principle)
    expect(audit.hypotheses[0]?.recommendation).toBe(MOCK_AUDIT_RESPONSE.hypotheses[0]?.recommendation)
  })
})
