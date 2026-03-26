import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'

// ─── Provider interface ───────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'mimo' | 'openai'

export interface ProviderModels {
  quality: string  // Best model — used for full audits
  fast: string     // Cheaper/faster model — for screening (Phase 1)
}

export interface StructuredCallOptions<T> {
  /** Logical model tier — provider resolves the actual model name */
  modelTier: 'quality' | 'fast'
  system: string
  messages: Anthropic.MessageParam[]
  toolName: string
  toolDescription: string
  schema: z.ZodType<T>
  maxTokens?: number
}

export interface StructuredCallResult<T> {
  result: T
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCostUsd: number
  }
  provider: ProviderName
  modelUsed: string
}

export interface LLMProvider {
  name: ProviderName
  models: ProviderModels
  isAvailable(): boolean
  callStructured<T>(options: StructuredCallOptions<T>): Promise<StructuredCallResult<T>>
}

// ─── Billing / quota error detection ─────────────────────────────────────
// When these errors occur we try the next provider rather than crashing.

export function isBillingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  // Anthropic: credit_balance_too_low, billing, payment required
  if (msg.includes('credit') || msg.includes('billing') || msg.includes('payment')) return true
  // HTTP status codes embedded in SDK errors
  const statusMatch = msg.match(/\b(402|401)\b/)
  if (statusMatch) return true
  // OpenAI: insufficient_quota, quota exceeded
  if (msg.includes('insufficient_quota') || msg.includes('quota')) return true
  // Provider doesn't support the requested model — fall through to next
  if (msg.includes('not supported model') || msg.includes('param incorrect')) return true
  // Rate limit treated as temporary — do NOT fall back for 429s
  return false
}

// ─── Provider registry ────────────────────────────────────────────────────

const _registry: LLMProvider[] = []

export function registerProvider(provider: LLMProvider): void {
  _registry.push(provider)
}

/**
 * Returns providers in priority order, filtered to those with credentials.
 * Order: Anthropic → MIMO → OpenAI
 */
export function getAvailableProviders(): LLMProvider[] {
  // Registry is populated lazily on first use via initProviders()
  ensureInitialised()
  return _registry.filter(p => p.isAvailable())
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────
// Tracks consecutive failures per provider. After OPEN_AFTER_FAILURES
// consecutive errors, the circuit opens and that provider is skipped for
// RESET_AFTER_MS milliseconds before being retried.

const OPEN_AFTER_FAILURES = 3
const RESET_AFTER_MS = 60_000  // 1 minute

interface CircuitState {
  failures: number
  openedAt: number | null
}

const _circuits = new Map<string, CircuitState>()

function getCircuit(name: string): CircuitState {
  if (!_circuits.has(name)) _circuits.set(name, { failures: 0, openedAt: null })
  return _circuits.get(name)!
}

function isCircuitOpen(name: string): boolean {
  const c = getCircuit(name)
  if (c.openedAt === null) return false
  if (Date.now() - c.openedAt >= RESET_AFTER_MS) {
    // Half-open: reset and allow one attempt
    c.failures = 0
    c.openedAt = null
    return false
  }
  return true
}

function recordSuccess(name: string): void {
  const c = getCircuit(name)
  c.failures = 0
  c.openedAt = null
}

function recordFailure(name: string): void {
  const c = getCircuit(name)
  c.failures++
  if (c.failures >= OPEN_AFTER_FAILURES) {
    c.openedAt = Date.now()
  }
}

/**
 * Call with automatic fallback: tries each available provider in order.
 * Falls back on billing/auth errors. Skips providers whose circuit is open
 * (≥3 consecutive failures within the last 60s).
 */
export async function callWithFallback<T>(
  options: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const providers = getAvailableProviders()

  if (providers.length === 0) {
    throw new Error(
      'No AI provider credentials found. Set one of:\n' +
      '  ANTHROPIC_API_KEY  — https://console.anthropic.com\n' +
      '  MIMO_API_KEY       — with XIAOMIMIMO_API_BASE_URL\n' +
      '  OPENAI_API_KEY     — https://platform.openai.com'
    )
  }

  let lastError: Error = new Error('Unknown error')

  for (const provider of providers) {
    // Skip providers whose circuit is open (too many recent failures)
    if (isCircuitOpen(provider.name)) {
      console.error(`  [provider] ${provider.name}: circuit open — skipping (too many recent failures)`)
      lastError = new Error(`${provider.name} circuit open`)
      continue
    }

    try {
      const result = await provider.callStructured(options)
      recordSuccess(provider.name)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (isBillingError(error)) {
        console.error(`  [provider] ${provider.name}: billing/quota error — trying next provider`)
        recordFailure(provider.name)
        lastError = error
        continue
      }
      // Non-billing error — record failure for circuit tracking but still propagate
      recordFailure(provider.name)
      throw error
    }
  }

  throw lastError
}

// ─── Lazy initialisation ──────────────────────────────────────────────────

let _initialised = false

function ensureInitialised(): void {
  if (_initialised) return
  _initialised = true

  // Providers imported here to avoid circular deps
  void import('./anthropic-provider.js').then(({ AnthropicProvider }) => {
    registerProvider(new AnthropicProvider())
  })
  void import('./openai-provider.js').then(({ OpenAICompatProvider }) => {
    // MIMO first (preferred fallback — serves Claude models)
    registerProvider(new OpenAICompatProvider('mimo'))
    // OpenAI as final fallback
    registerProvider(new OpenAICompatProvider('openai'))
  })
}

// Synchronous init — call once at startup so providers are ready before first request
export async function initProviders(): Promise<void> {
  const { AnthropicProvider } = await import('./anthropic-provider.js')
  const { OpenAICompatProvider } = await import('./openai-provider.js')

  _registry.length = 0  // Reset in case of re-init
  _registry.push(
    new AnthropicProvider(),
    new OpenAICompatProvider('mimo'),
    new OpenAICompatProvider('openai'),
  )
  _initialised = true
}
