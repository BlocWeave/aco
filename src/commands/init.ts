import chalk from 'chalk'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const ACO_MD_TEMPLATE = `---
brand:
  name: [YOUR BRAND NAME]
  tagline: [YOUR ONE-LINE TAGLINE]
  tone: professional, friendly, confident
  audience: [WHO YOUR CUSTOMERS ARE — e.g., "B2B SaaS founders", "e-commerce shoppers aged 25-45"]
  value_proposition: [WHAT UNIQUE VALUE YOU DELIVER]

goals:
  primary: [PRIMARY CONVERSION ACTION — e.g., "get visitors to sign up for a free trial"]
  url: [YOUR LANDING PAGE URL]

constraints:
  voice: [DESCRIBE YOUR BRAND VOICE — e.g., "like talking to a knowledgeable friend, not a salesperson"]
  allowed_categories:
    - copy
    - cta
    - social_proof
  never_change:
    - do not remove the company logo or alter brand colors
    - do not change pricing unless explicitly approved
    - do not add fake urgency or false scarcity claims
---

# Brand Soul

## Who We Are
[2-3 sentences about your company, what you do, and why you exist]

## Our Customer
[Who is the ideal visitor to this page? What are they trying to accomplish?
What are their fears, frustrations, and aspirations?]

## What Makes Us Different
[Your genuine differentiation — not generic claims. What do you do that
competitors don't, or what do you do significantly better?]

## Conversion Goal
[Be specific: "We want visitors to click 'Start Free Trial' and complete the
signup form. A 'conversion' = completed account creation."]

## Tone Guidelines
[How should the agent write? Examples of voice you like and don't like.
Reference: "Write like [Stripe/Linear/Notion] — clear, confident, and direct.
Not like [example]: verbose, jargon-heavy, corporate."]

## What Not To Touch
[Specific things the agent must not change — legal disclaimers, specific
pricing structures, brand terms, etc.]
`

export async function runInit(): Promise<void> {
  const acoMdPath = path.join(process.cwd(), 'aco.md')

  console.log()
  console.log(chalk.bold('⚡ ACO Init'))
  console.log()

  // Check if already exists
  try {
    await fs.access(acoMdPath)
    console.log(chalk.yellow(`  aco.md already exists at ${acoMdPath}`))
    console.log(chalk.dim('  Edit it to update your brand configuration.'))
    console.log()
    return
  } catch {
    // Good — doesn't exist yet
  }

  await fs.writeFile(acoMdPath, ACO_MD_TEMPLATE, 'utf-8')

  console.log(chalk.green('  ✓ Created aco.md'))
  console.log()
  console.log('  This is your ' + chalk.bold('Brand Soul') + ' — it teaches ACO about:')
  console.log(chalk.dim('    · Your brand, audience, and value proposition'))
  console.log(chalk.dim('    · The primary conversion goal'))
  console.log(chalk.dim('    · Your brand voice and tone'))
  console.log(chalk.dim('    · What the agent is and isn\'t allowed to change'))
  console.log()
  console.log('  ' + chalk.bold('Next steps:'))
  console.log(chalk.dim('    1. Edit aco.md and fill in your brand details'))
  console.log(chalk.dim('    2. Run: aco audit <your-url>'))
  console.log()
}
