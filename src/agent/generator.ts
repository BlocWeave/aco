import { callWithFallback } from '../integrations/providers.js'
import {
  ChangeSpecArraySchema,
  PRINCIPLE_DESCRIPTIONS,
  type ChangeCategory,
  type ChangeSpec,
  type Hypothesis,
  type AcoConfig,
} from '../types.js'
import type { TokenUsage } from '../integrations/claude.js'

// ─── Input / Output ───────────────────────────────────────────────────────

export interface GeneratorInput {
  hypothesis: Hypothesis
  pageHtml: string
  programConfig: AcoConfig
  allowedCategories: ChangeCategory[]
}

export interface GeneratorResult {
  changes: ChangeSpec[]
  skipped: boolean
  skipReason: string | undefined
  usage: TokenUsage
  provider: string
  modelUsed: string
}

// ─── HTML extraction ──────────────────────────────────────────────────────
// Trim the HTML to a relevant window around the target element.
// Keeps prompt size manageable and focuses the LLM on the right area.

export function extractRelevantHtml(fullHtml: string, element: string): string {
  const MAX_CHARS = 12_000
  const WINDOW = 3_000

  // Find a rough center using keywords from the element description
  const keywords = element.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  let bestIdx = -1

  for (const kw of keywords) {
    const idx = fullHtml.toLowerCase().indexOf(kw)
    if (idx !== -1) {
      bestIdx = idx
      break
    }
  }

  if (bestIdx === -1) {
    // Element text not found — return the first MAX_CHARS chars
    return fullHtml.slice(0, MAX_CHARS)
  }

  const start = Math.max(0, bestIdx - WINDOW)
  const end = Math.min(fullHtml.length, bestIdx + WINDOW)
  return fullHtml.slice(start, end)
}

// ─── System prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a surgical code editor that implements CRO hypotheses by changing text/copy in source files.

RULES — CRITICAL:
1. You ONLY change text content: headlines, button labels, body copy, link text, alt text, placeholder text.
2. You NEVER change: HTML structure, CSS classes, component logic, imports, or non-text attributes.
3. The searchText you provide MUST appear EXACTLY ONCE in the file content. Make it long enough (20+ chars) to be unique.
4. The replacementText must preserve all surrounding HTML/JSX structure — only change the visible text.
5. If the hypothesis cannot be implemented as a pure text change, set skipped=true and explain why.
6. Never invent facts, claims, or statistics that aren't in the original page.
7. Never change anything listed in the "Never change" list below.

Conversion principles you apply:
${Object.entries(PRINCIPLE_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`

// ─── Prompt builder ───────────────────────────────────────────────────────

export function buildGeneratorPrompt(input: GeneratorInput): string {
  const { hypothesis, pageHtml, programConfig, allowedCategories } = input
  const { brand, constraints } = programConfig

  const neverChange = constraints.thingsToNeverChange?.length
    ? constraints.thingsToNeverChange.map(s => `- ${s}`).join('\n')
    : '(none specified)'

  const relevantHtml = extractRelevantHtml(pageHtml, hypothesis.element)

  return [
    `## Hypothesis to Implement`,
    `ID: ${hypothesis.id}`,
    `Principle: ${hypothesis.principle}`,
    `Element: ${hypothesis.element}`,
    `Current state: ${hypothesis.current_state}`,
    `Issue: ${hypothesis.issue}`,
    `Recommendation: ${hypothesis.recommendation}`,
    `Why it works: ${hypothesis.why_it_works}`,
    '',
    `## Brand Voice`,
    `Brand name: ${brand.name}`,
    `Tone: ${brand.tone ?? '(not specified)'}`,
    `Value proposition: ${brand.valueProposition ?? '(not specified)'}`,
    '',
    `## Allowed Change Categories for This Run`,
    allowedCategories.join(', '),
    '',
    `## Never Change`,
    neverChange,
    '',
    `## Relevant Page Source (trimmed)`,
    '```html',
    relevantHtml,
    '```',
    '',
    `## Your Task`,
    `Implement this hypothesis as one or more text-only changes.`,
    `For each change: identify the EXACT current text in the source, and provide the replacement.`,
    `The searchText must appear exactly once in the source above.`,
    `If the hypothesis requires structural changes (not just text), set skipped=true.`,
  ].join('\n')
}

// ─── Change validation ────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateChangeSpec(spec: ChangeSpec, fileContent: string): ValidationResult {
  const occurrences = countOccurrences(fileContent, spec.searchText)

  if (occurrences === 0) {
    return { valid: false, error: `searchText not found in file: "${spec.searchText.slice(0, 60)}..."` }
  }

  if (occurrences > 1) {
    return { valid: false, error: `searchText appears ${occurrences} times in file (must be exactly 1): "${spec.searchText.slice(0, 60)}..."` }
  }

  return { valid: true }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

// ─── Generator ────────────────────────────────────────────────────────────

export async function generateChanges(input: GeneratorInput): Promise<GeneratorResult> {
  const prompt = buildGeneratorPrompt(input)

  const { result, usage, provider, modelUsed } = await callWithFallback({
    modelTier: 'quality',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    toolName: 'submit_changes',
    toolDescription: 'Submit the text changes that implement this CRO hypothesis',
    schema: ChangeSpecArraySchema,
    maxTokens: 4096,
  })

  // Enforce allowed categories as a hard rule — drop any change the LLM mislabeled
  const filteredChanges = result.changes.filter(c => {
    if (!input.allowedCategories.includes(c.category)) {
      console.warn(`[generator] Dropped change: category '${c.category}' not in allowed list`)
      return false
    }
    return true
  })

  // Tag each change with the hypothesis ID
  const taggedChanges: ChangeSpec[] = filteredChanges.map(c => ({
    ...c,
    hypothesisId: input.hypothesis.id,
  }))

  return {
    changes: taggedChanges,
    skipped: result.skipped,
    skipReason: result.skipReason,
    usage,
    provider,
    modelUsed,
  }
}
