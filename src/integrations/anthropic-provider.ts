import Anthropic from '@anthropic-ai/sdk'
import { zodToJsonSchema, calculateCost } from './claude.js'
import type { LLMProvider, ProviderModels, StructuredCallOptions, StructuredCallResult } from './providers.js'

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const

  readonly models: ProviderModels = {
    quality: 'claude-sonnet-4-6',
    fast: 'claude-haiku-4-5',
  }

  private _client: Anthropic | null = null

  isAvailable(): boolean {
    return !!process.env['ANTHROPIC_API_KEY']
  }

  private getClient(): Anthropic {
    if (!this._client) {
      const apiKey = process.env['ANTHROPIC_API_KEY']!
      this._client = new Anthropic({ apiKey })
    }
    return this._client
  }

  async callStructured<T>(options: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
    const { modelTier, system, messages, toolName, toolDescription, schema, maxTokens = 4096 } = options
    const model = this.models[modelTier]
    const client = this.getClient()
    const jsonSchema = zodToJsonSchema(schema)

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: [{
        name: toolName,
        description: toolDescription,
        input_schema: jsonSchema as Anthropic.Tool['input_schema'],
      }],
      tool_choice: { type: 'tool', name: toolName },
    })

    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    if (!toolUseBlock) {
      throw new Error(`Anthropic did not use the '${toolName}' tool. Response: ${JSON.stringify(response.content)}`)
    }

    const parsed = schema.safeParse(toolUseBlock.input)
    if (!parsed.success) {
      throw new Error(`Anthropic structured output failed validation:\n${parsed.error.toString()}`)
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
      provider: 'anthropic',
      modelUsed: model,
    }
  }
}
