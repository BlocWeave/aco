import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isBillingError } from '../../src/integrations/providers.js'

// ─── isBillingError ───────────────────────────────────────────────────────

describe('isBillingError', () => {
  it('returns false for non-Error values', () => {
    expect(isBillingError('string error')).toBe(false)
    expect(isBillingError(null)).toBe(false)
    expect(isBillingError(42)).toBe(false)
    expect(isBillingError(undefined)).toBe(false)
  })

  it('returns true for Anthropic credit balance errors', () => {
    expect(isBillingError(new Error('credit_balance_too_low'))).toBe(true)
    expect(isBillingError(new Error('Your account has insufficient credits'))).toBe(true)
    expect(isBillingError(new Error('BILLING issue detected'))).toBe(true)
  })

  it('returns true for payment required errors', () => {
    expect(isBillingError(new Error('Payment required to continue'))).toBe(true)
  })

  it('returns true for HTTP 402 embedded in message', () => {
    expect(isBillingError(new Error('Request failed with status 402'))).toBe(true)
  })

  it('returns true for HTTP 401 embedded in message', () => {
    expect(isBillingError(new Error('Unauthorized — status 401'))).toBe(true)
  })

  it('returns true for OpenAI quota errors', () => {
    expect(isBillingError(new Error('insufficient_quota'))).toBe(true)
    expect(isBillingError(new Error('You have exceeded your quota for this month'))).toBe(true)
  })

  it('returns false for rate limit errors (should not trigger fallback)', () => {
    expect(isBillingError(new Error('Rate limit exceeded — too many requests'))).toBe(false)
    expect(isBillingError(new Error('429 Too Many Requests'))).toBe(false)
  })

  it('returns false for generic errors', () => {
    expect(isBillingError(new Error('Network error'))).toBe(false)
    expect(isBillingError(new Error('Internal server error'))).toBe(false)
    expect(isBillingError(new Error('Timeout'))).toBe(false)
  })
})

// ─── callWithFallback — provider selection ────────────────────────────────

describe('callWithFallback', () => {
  // Save original env so we can restore it
  const originalEnv = { ...process.env }

  afterEach(() => {
    // Restore env
    Object.keys(process.env).forEach(k => {
      if (!(k in originalEnv)) delete process.env[k]
    })
    Object.assign(process.env, originalEnv)

    vi.resetModules()
  })

  it('throws a helpful error when no provider credentials are set', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    delete process.env['MIMO_API_KEY']
    delete process.env['OPENAI_API_KEY']
    delete process.env['XIAOMIMIMO_API_BASE_URL']

    // Re-import to get fresh module state (registry resets)
    const { callWithFallback, initProviders } = await import('../../src/integrations/providers.js')
    await initProviders()

    const { z } = await import('zod')
    await expect(
      callWithFallback({
        modelTier: 'quality',
        system: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        toolName: 'test',
        toolDescription: 'test',
        schema: z.object({ value: z.string() }),
      })
    ).rejects.toThrow('No AI provider credentials found')
  })
})

// ─── Provider availability ────────────────────────────────────────────────

describe('AnthropicProvider.isAvailable', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('returns true when ANTHROPIC_API_KEY is set', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test'
    const { AnthropicProvider } = await import('../../src/integrations/anthropic-provider.js')
    expect(new AnthropicProvider().isAvailable()).toBe(true)
  })

  it('returns false when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env['ANTHROPIC_API_KEY']
    const { AnthropicProvider } = await import('../../src/integrations/anthropic-provider.js')
    expect(new AnthropicProvider().isAvailable()).toBe(false)
  })
})

describe('OpenAICompatProvider.isAvailable', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('mimo: returns true when MIMO_API_KEY and XIAOMIMIMO_API_BASE_URL are both set', async () => {
    process.env['MIMO_API_KEY'] = 'test-mimo-key'
    process.env['XIAOMIMIMO_API_BASE_URL'] = 'https://api.xiaomimimo.com/v1'
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('mimo').isAvailable()).toBe(true)
  })

  it('mimo: returns false when only MIMO_API_KEY is set (no base URL)', async () => {
    process.env['MIMO_API_KEY'] = 'test-mimo-key'
    delete process.env['XIAOMIMIMO_API_BASE_URL']
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('mimo').isAvailable()).toBe(false)
  })

  it('mimo: returns false when only XIAOMIMIMO_API_BASE_URL is set (no key)', async () => {
    delete process.env['MIMO_API_KEY']
    process.env['XIAOMIMIMO_API_BASE_URL'] = 'https://api.xiaomimimo.com/v1'
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('mimo').isAvailable()).toBe(false)
  })

  it('openai: returns true when OPENAI_API_KEY is set', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test-openai-key'
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('openai').isAvailable()).toBe(true)
  })

  it('openai: returns false when OPENAI_API_KEY is not set', async () => {
    delete process.env['OPENAI_API_KEY']
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('openai').isAvailable()).toBe(false)
  })
})

// ─── Provider model defaults ──────────────────────────────────────────────

describe('provider model defaults', () => {
  afterEach(() => {
    vi.resetModules()
    delete process.env['ACO_MIMO_QUALITY_MODEL']
    delete process.env['ACO_MIMO_FAST_MODEL']
    delete process.env['ACO_OPENAI_QUALITY_MODEL']
    delete process.env['ACO_OPENAI_FAST_MODEL']
  })

  it('MIMO defaults to MiMo-V2-Flash for both quality and fast', async () => {
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    const p = new OpenAICompatProvider('mimo')
    expect(p.models.quality).toBe('MiMo-V2-Flash')
    expect(p.models.fast).toBe('MiMo-V2-Flash')
  })

  it('OpenAI defaults to gpt-4o (quality) and gpt-4o-mini (fast)', async () => {
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    const p = new OpenAICompatProvider('openai')
    expect(p.models.quality).toBe('gpt-4o')
    expect(p.models.fast).toBe('gpt-4o-mini')
  })

  it('respects ACO_MIMO_QUALITY_MODEL override', async () => {
    process.env['ACO_MIMO_QUALITY_MODEL'] = 'claude-opus-4-6'
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('mimo').models.quality).toBe('claude-opus-4-6')
  })

  it('respects ACO_OPENAI_QUALITY_MODEL override', async () => {
    process.env['ACO_OPENAI_QUALITY_MODEL'] = 'gpt-4.1'
    const { OpenAICompatProvider } = await import('../../src/integrations/openai-provider.js')
    expect(new OpenAICompatProvider('openai').models.quality).toBe('gpt-4.1')
  })
})
