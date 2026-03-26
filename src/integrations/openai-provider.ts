import OpenAI from 'openai'
import type Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema } from './claude.js'
import type { LLMProvider, ProviderName, ProviderModels, StructuredCallOptions, StructuredCallResult } from './providers.js'

// ─── OpenAI cost table (per million tokens) ───────────────────────────────

const OPENAI_COST: Record<string, { input: number; output: number }> = {
  'gpt-4o':          { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':     { input: 0.15,  output: 0.60  },
  'gpt-4.1':         { input: 2.00,  output: 8.00  },
  'gpt-4.1-mini':    { input: 0.40,  output: 1.60  },
  // MIMO models
  'MiMo-V2-Flash': { input: 0.50, output: 2.00 },
}

// ─── Message format conversion ────────────────────────────────────────────
// Anthropic and OpenAI use different image block schemas.

type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

function convertMessages(system: string, messages: Anthropic.MessageParam[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [{ role: 'system', content: system }]

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
      continue
    }

    const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = []

    for (const block of msg.content) {
      if (block.type === 'text') {
        parts.push({ type: 'text', text: block.text })
        continue
      }

      if (block.type === 'image') {
        // Convert Anthropic base64 image → OpenAI data URI image
        const src = block.source
        if (src.type === 'base64') {
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${src.media_type};base64,${src.data}` },
          })
        } else if (src.type === 'url') {
          // Cast through unknown — Anthropic SDK may not export the URL source type
          const urlSrc = src as unknown as { type: 'url'; url: string }
          parts.push({ type: 'image_url', image_url: { url: urlSrc.url } })
        }
      }
    }

    // OpenAI requires separate types for user vs assistant with content arrays
    if (msg.role === 'user') {
      result.push({ role: 'user', content: parts })
    } else {
      // Assistant messages with arrays: use text-only fallback
      const text = parts.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('\n')
      result.push({ role: 'assistant', content: text })
    }
  }

  return result
}

// ─── Provider implementation ──────────────────────────────────────────────

export class OpenAICompatProvider implements LLMProvider {
  readonly name: ProviderName
  readonly models: ProviderModels
  private _client: OpenAI | null = null

  constructor(name: 'mimo' | 'openai') {
    this.name = name

    if (name === 'mimo') {
      // MIMO uses its own model names — not Anthropic model IDs.
      this.models = {
        quality: process.env['ACO_MIMO_QUALITY_MODEL'] ?? 'MiMo-V2-Flash',
        fast:    process.env['ACO_MIMO_FAST_MODEL']    ?? 'MiMo-V2-Flash',
      }
    } else {
      // Native OpenAI — use GPT models
      this.models = {
        quality: process.env['ACO_OPENAI_QUALITY_MODEL'] ?? 'gpt-4o',
        fast:    process.env['ACO_OPENAI_FAST_MODEL']    ?? 'gpt-4o-mini',
      }
    }
  }

  isAvailable(): boolean {
    if (this.name === 'mimo') {
      return !!(process.env['MIMO_API_KEY'] && process.env['XIAOMIMIMO_API_BASE_URL'])
    }
    return !!process.env['OPENAI_API_KEY']
  }

  private getClient(): OpenAI {
    if (!this._client) {
      if (this.name === 'mimo') {
        this._client = new OpenAI({
          apiKey: process.env['MIMO_API_KEY']!,
          baseURL: process.env['XIAOMIMIMO_API_BASE_URL']!,
        })
      } else {
        this._client = new OpenAI({ apiKey: process.env['OPENAI_API_KEY']! })
      }
    }
    return this._client
  }

  async callStructured<T>(options: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
    const { modelTier, system, messages, toolName, toolDescription, schema, maxTokens = 4096 } = options
    const model = this.models[modelTier]
    const client = this.getClient()
    const jsonSchema = zodToJsonSchema(schema)

    const response = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: convertMessages(system, messages),
      tools: [{
        type: 'function',
        function: {
          name: toolName,
          description: toolDescription,
          parameters: jsonSchema,
        },
      }],
      tool_choice: { type: 'function', function: { name: toolName } },
    })

    const toolCallRaw = response.choices[0]?.message.tool_calls?.[0]
    // Narrow to standard function tool call — custom tool calls lack .function
    if (!toolCallRaw || toolCallRaw.type !== 'function') {
      throw new Error(`${this.name} did not call the '${toolName}' function. Response: ${JSON.stringify(response.choices[0]?.message)}`)
    }
    const toolCall = toolCallRaw as { type: 'function'; function: { name: string; arguments: string } }

    let rawInput: unknown
    try {
      rawInput = JSON.parse(toolCall.function.arguments)
    } catch {
      throw new Error(`${this.name} returned invalid JSON in function arguments: ${toolCall.function.arguments}`)
    }

    const parsed = schema.safeParse(rawInput)
    if (!parsed.success) {
      throw new Error(`${this.name} structured output failed validation:\n${parsed.error.toString()}`)
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0
    const outputTokens = response.usage?.completion_tokens ?? 0
    const costEntry = OPENAI_COST[model] ?? { input: 3.00, output: 15.00 }
    const finalCost = (inputTokens / 1_000_000) * costEntry.input + (outputTokens / 1_000_000) * costEntry.output

    return {
      result: parsed.data,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUsd: finalCost,
      },
      provider: this.name,
      modelUsed: model,
    }
  }
}
