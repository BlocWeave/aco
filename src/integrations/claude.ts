import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// ─── Client Singleton ─────────────────────────────────────────────────────

let _client: Anthropic | null = null

export function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is not set.\n' +
        'Get your key at https://console.anthropic.com and run:\n' +
        '  export ANTHROPIC_API_KEY=sk-ant-...'
      )
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

// ─── Model Constants ──────────────────────────────────────────────────────

export const MODELS = {
  // Fast, cheap — hypothesis screening, quick analysis
  fast: 'claude-haiku-4-5' as const,
  // High quality — main audit analysis, code generation
  quality: 'claude-sonnet-4-6' as const,
} as const

export type ModelId = typeof MODELS[keyof typeof MODELS]

// ─── Token Tracker ────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
}

const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  [MODELS.fast]: { input: 0.80, output: 4.00 },
  [MODELS.quality]: { input: 3.00, output: 15.00 },
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = COST_PER_MILLION[model] ?? { input: 3.00, output: 15.00 }
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output
}

// ─── Structured Output via Tool Use ───────────────────────────────────────
// We use tool_use to force structured JSON output — more reliable than asking
// the model to "output valid JSON" in prose.

export interface StructuredCallOptions<T> {
  model: ModelId
  system: string
  messages: Anthropic.MessageParam[]
  toolName: string
  toolDescription: string
  schema: z.ZodType<T>
  maxTokens?: number
}

export interface StructuredCallResult<T> {
  result: T
  usage: TokenUsage
}

export async function callStructured<T>(
  options: StructuredCallOptions<T>
): Promise<StructuredCallResult<T>> {
  const {
    model,
    system,
    messages,
    toolName,
    toolDescription,
    schema,
    maxTokens = 4096,
  } = options

  const client = getClient()

  // Convert Zod schema to JSON Schema for the tool definition
  // We do this manually for the shapes we use — keeps the dep tree lean
  const jsonSchema = zodToJsonSchema(schema)

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    tools: [
      {
        name: toolName,
        description: toolDescription,
        input_schema: jsonSchema as Anthropic.Tool['input_schema'],
      },
    ],
    tool_choice: { type: 'tool', name: toolName },
  })

  // Find the tool use block
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  )

  if (!toolUseBlock) {
    throw new Error(`Claude did not use the '${toolName}' tool as expected. Response: ${JSON.stringify(response.content)}`)
  }

  // Parse and validate the tool input against our Zod schema
  const parsed = schema.safeParse(toolUseBlock.input)
  if (!parsed.success) {
    throw new Error(
      `Claude's structured output failed Zod validation:\n${parsed.error.toString()}\n\nRaw input: ${JSON.stringify(toolUseBlock.input, null, 2)}`
    )
  }

  const inputTokens = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens

  return {
    result: parsed.data,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostUsd: calculateCost(model, inputTokens, outputTokens),
    },
  }
}

// ─── Minimal Zod → JSON Schema converter ─────────────────────────────────
// Handles the shapes we actually use. Not a general-purpose converter.

export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, value] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
      properties[key] = zodToJsonSchema(value)
      // Check if field is required (not optional)
      if (!(value instanceof z.ZodOptional)) {
        required.push(key)
      }
    }

    return { type: 'object', properties, required }
  }

  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodToJsonSchema(schema.element),
      ...(schema._def.minLength != null ? { minItems: schema._def.minLength.value } : {}),
      ...(schema._def.maxLength != null ? { maxItems: schema._def.maxLength.value } : {}),
    }
  }

  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options }
  }

  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' }
    if (schema.description) result['description'] = schema.description
    return result
  }

  if (schema instanceof z.ZodNumber) {
    const result: Record<string, unknown> = { type: 'number' }
    if (schema._def.checks) {
      for (const check of schema._def.checks) {
        if (check.kind === 'min') result['minimum'] = check.value
        if (check.kind === 'max') result['maximum'] = check.value
      }
    }
    return result
  }

  if (schema instanceof z.ZodBoolean) {
    return { type: 'boolean' }
  }

  if (schema instanceof z.ZodOptional) {
    return zodToJsonSchema(schema.unwrap())
  }

  if (schema instanceof z.ZodNullable) {
    return { ...zodToJsonSchema(schema.unwrap()), nullable: true }
  }

  // Fallback for unknown types
  return {}
}
