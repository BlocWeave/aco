import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AcoConfig } from '../types.js'

// ─── aco.md Parser ────────────────────────────────────────────────────────
// Parses the YAML-like frontmatter in aco.md for structured config.
// Falls back to minimal defaults if not present.

const DEFAULT_CONFIG: AcoConfig = {
  brand: { name: 'Unknown' },
  goals: { primaryConversionGoal: 'Get visitors to convert (sign up, purchase, or contact)' },
  constraints: { allowedChangeCategories: ['copy', 'cta', 'social_proof'] },
}

export async function loadAcoConfig(dir?: string): Promise<AcoConfig | undefined> {
  const searchDir = dir ?? process.cwd()
  const acoMdPath = path.join(searchDir, 'aco.md')

  try {
    const content = await fs.readFile(acoMdPath, 'utf-8')
    return parseAcoMd(content)
  } catch {
    return undefined  // aco.md is optional
  }
}

export function parseAcoMd(content: string): AcoConfig {
  const config: AcoConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG))

  // Extract frontmatter between --- blocks
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!frontmatterMatch?.[1]) {
    // No frontmatter — try to extract from markdown sections
    return extractFromMarkdown(content, config)
  }

  const frontmatter = frontmatterMatch[1]
  const lines = frontmatter.split('\n')

  let currentSection: string | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Top-level key
    const topMatch = trimmed.match(/^(\w+):(.*)$/)
    if (topMatch && !line.startsWith(' ')) {
      currentSection = topMatch[1] ?? null
      const value = topMatch[2]?.trim()

      if (currentSection === 'brand' && value) {
        config.brand.name = value
      }
      continue
    }

    // Nested key under current section
    const nestedMatch = trimmed.match(/^(\w+):\s*(.+)$/)
    if (nestedMatch && currentSection) {
      const [, key, value] = nestedMatch
      if (!key || !value) continue

      switch (currentSection) {
        case 'brand': {
          // Map snake_case frontmatter keys to camelCase config keys.
          // Using explicit mapping rather than `key in config.brand` because
          // optional properties that start as `undefined` are not enumerable.
          const BRAND_KEY_MAP: Record<string, keyof typeof config.brand> = {
            name: 'name',
            tagline: 'tagline',
            tone: 'tone',
            audience: 'audience',
            value_proposition: 'valueProposition',
          }
          const mapped = BRAND_KEY_MAP[key]
          if (mapped) {
            (config.brand as Record<string, string>)[mapped] = value
          }
          break
        }
        case 'goals':
          if (key === 'primary') config.goals.primaryConversionGoal = value
          if (key === 'url') config.targetUrl = value
          break
        case 'constraints':
          if (key === 'voice') config.constraints.brandVoice = value
          break
      }
    }

    // List items
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (listMatch?.[1] && currentSection === 'constraints') {
      const item = listMatch[1]
      if (item.startsWith('no ') || item.startsWith('never ') || item.startsWith('do not ')) {
        config.constraints.thingsToNeverChange ??= []
        config.constraints.thingsToNeverChange.push(item)
      } else if (['copy', 'cta', 'social_proof', 'layout', 'structure'].includes(item)) {
        if (!config.constraints.allowedChangeCategories.includes(item as never)) {
          config.constraints.allowedChangeCategories.push(item as never)
        }
      }
    }
  }

  return config
}

function extractFromMarkdown(content: string, config: AcoConfig): AcoConfig {
  // Brand name from first H1
  const h1Match = content.match(/^#\s+(.+)/m)
  if (h1Match?.[1]) config.brand.name = h1Match[1].trim()

  // Goal from "Goal:" or "Primary Goal:" line
  const goalMatch = content.match(/(?:primary\s+)?goal:?\s*(.+)/i)
  if (goalMatch?.[1]) config.goals.primaryConversionGoal = goalMatch[1].trim()

  // URL from "URL:" line
  const urlMatch = content.match(/url:?\s*(https?:\/\/\S+)/i)
  if (urlMatch?.[1]) config.targetUrl = urlMatch[1]

  return config
}

export { DEFAULT_CONFIG }
