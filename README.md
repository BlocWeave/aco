# ACO — Autonomous Conversion Optimizer

> Your landing page, optimizing itself.

ACO is an open source AI agent that runs a continuous loop of hypothesis → code change → visual regression → Git commit on your landing pages. It keeps what works, reverts what doesn't — and runs 24/7 without a CRO team.

```bash
npx @aco/cli audit stripe.com
```

**210 tests passing · Apache-2.0 · SaaS at [aco.dev](https://aco.dev)**

---

## What It Does

**One command for a full audit:**

```bash
aco audit stripe.com
```

→ Outputs `aco-report.html` with:
- Conversion readiness scores (Clarity, Trust, Urgency, Social Proof)
- 5–8 testable hypotheses, each grounded in a named Cialdini persuasion principle
- The #1 conversion problem on the page
- Quick wins achievable in under 30 minutes
- Full-page screenshot at audit time

**Continuous autonomous optimization:**

```bash
aco run
```

→ Runs the full loop on your local codebase:
1. Playwright captures the page — screenshot, DOM, Core Web Vitals, accessibility
2. Claude proposes a hypothesis grounded in Cialdini's principles
3. Agent implements the change as a precise text diff
4. Visual regression validates the page looks intact
5. Passes → Git commit. Fails → automatic revert
6. Repeat

---

## Quick Start

**Requirements:** Node.js 20+, an [Anthropic API key](https://console.anthropic.com)

```bash
# Install
npm install -g @aco/cli

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Audit any landing page
aco audit stripe.com

# Audit on mobile viewport
aco audit stripe.com --mobile

# Initialize a campaign (creates aco.md)
aco init

# Run a continuous optimization cycle
aco run

# Check experiment status
aco status

# Roll back the last experiment
aco rollback
```

---

## Commands

| Command | Description |
|---|---|
| `aco audit <url>` | One-shot audit → `aco-report.html` |
| `aco init` | Scaffold `aco.md` with brand template |
| `aco run` | Run one optimization cycle |
| `aco run --continuous` | Run continuously on a schedule |
| `aco status` | Show experiment history and outcomes |
| `aco rollback` | Revert the last accepted experiment |

---

## aco.md — Your Brand Instructions

`aco.md` is how you instruct the agent. It's the human-maintained file that guides the AI's decisions — your brand brief, conversion goal, and guardrails in one place.

```bash
aco init   # scaffolds aco.md in the current directory
```

Configure:
- Your brand voice and target audience
- The primary conversion goal (be specific: what counts as a conversion?)
- What the agent is allowed to change (copy, CTAs, layout, social proof)
- What it must never touch (pricing, legal text, specific brand elements)

Full reference: [docs/aco-md.md](docs/aco-md.md)

---

## AI Providers

ACO supports multiple providers with automatic fallback:

```
Anthropic (Claude) → MIMO → OpenAI
```

Set whichever keys you have — ACO picks the first available:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # primary (recommended)
export OPENAI_API_KEY=sk-...          # fallback
```

Full provider guide: [docs/providers.md](docs/providers.md)

---

## Troubleshooting

**`aco audit` hangs or fails on page load**
Playwright may need browsers installed: `npx playwright install chromium`

**`Error: No AI provider available`**
No API keys are set. Export at least `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.

**`aco run` reverts every experiment**
The visual regression threshold (0.85 similarity) is conservative by design. If your page has heavy animations or dynamic content that changes between screenshots, run with a real static build or staging URL that doesn't change between requests.

**TypeScript or build errors after `npm install`**
Run `npm install` then `npm run build`. Requires Node.js 20+.

---

## Why Hypotheses, Not "Predicted Lift"

Other tools say "you're leaving 23% on the table." ACO doesn't.

Without your real traffic data, any specific lift percentage is invented. A confident-sounding number that doesn't match reality destroys trust before you've built any.

Instead, ACO gives you:
- The **psychological principle** behind each finding (Cialdini: authority, social proof, scarcity, etc.)
- The **specific element** that's underperforming and exactly why
- The **concrete change** to make
- The **metric to track** when you test it

The credibility comes from the reasoning quality. If it's sound, run the test. Let real traffic give you the number.

---

## Cialdini Principles

Every hypothesis cites one of these:

| Principle | CRO Application |
|---|---|
| **Reciprocity** | Give value before asking — free trial, free resource |
| **Commitment** | Reduce commitment anxiety — match ask to trust level |
| **Social Proof** | Show others doing it — testimonials, logos, counts |
| **Authority** | Demonstrate expertise — credentials, press mentions |
| **Scarcity** | Real urgency, not fake timers — limited spots, real deadlines |
| **Liking** | People buy from people they like — tone, personality, faces |
| **Unity** | Shared identity — "us" framing, community belonging |
| **Clarity** | Remove cognitive friction — clear headline, obvious CTA |
| **Trust** | Safety signals — guarantees, privacy, security badges |

---

## Architecture

```
src/
├── agent/
│   ├── observer.ts        # Playwright: screenshot, DOM, CWV, a11y
│   ├── hypothesizer.ts    # Claude: generate hypotheses (tool_use)
│   ├── generator.ts       # Claude: implement hypothesis as text diff
│   └── evaluator.ts       # Visual regression: sharp pixel comparison
├── integrations/
│   ├── claude.ts          # Anthropic SDK: structured output, token tracking
│   ├── providers.ts       # Multi-provider fallback (Anthropic → MIMO → OpenAI)
│   └── git.ts             # Git commit / revert
├── report/
│   └── generator.ts       # Self-contained HTML report (no external deps)
├── config/
│   └── program.ts         # aco.md parser (loadAcoConfig, parseAcoMd)
├── commands/
│   ├── audit.ts           # aco audit
│   ├── init.ts            # aco init
│   ├── run.ts             # aco run
│   ├── status.ts          # aco status
│   └── rollback.ts        # aco rollback
├── types.ts               # Zod schemas
└── cli.ts                 # Commander.js entry
```

**Key decisions:**
- `claude-sonnet-4-6` for audit and hypothesis quality
- Structured output via `tool_use` — not "please output valid JSON" prompting
- Zod validation on every LLM response — no silent schema failures
- Self-contained HTML report — no external CSS/JS, works offline, shareable
- Visual regression gate: `sharp` raw pixel comparison, similarity threshold 0.85

---

## Cost

Each audit uses `claude-sonnet-4-6` with vision. Typical cost: **$0.02–$0.08 per audit** depending on page complexity. Each optimization cycle: **$0.02–$0.08** for the hypothesis + code generation step.

Token usage and estimated cost are shown after every command and included in the audit report footer.

---

## SaaS Dashboard

The CLI is the open source core. For live traffic optimization, the [ACO SaaS](https://aco.dev) adds:

- **Cloudflare edge traffic splitting** — MurmurHash3 bucketing, no cookies, no flicker
- **Bayesian Multi-Armed Bandit** — Thompson Sampling promotes winners automatically
- **Human approval workflow** — review diff + before/after screenshots before anything goes live
- **Experiment timeline** — full Git-native history of every change and its outcome
- **Team access** — org management, role-based permissions

The CLI works standalone without a SaaS account. The SaaS requires a subscription for live traffic campaigns.

---

## Status

| Phase | What | Status |
|---|---|---|
| 0 | `aco audit` — one-shot HTML report | ✅ Complete |
| 1 | `aco run` — continuous local optimization loop, Git commits, visual regression | ✅ Complete — 210 tests |
| 1 | `aco status`, `aco rollback` | ✅ Complete |
| 1 | Multi-provider fallback (Anthropic → MIMO → OpenAI) | ✅ Complete |
| 2 | SaaS: Fastify API + Next.js dashboard + Cloudflare Worker | ✅ Complete |
| 2 | Clerk auth + Stripe billing + Bayesian MAB | ✅ Complete |
| 3 | ClickHouse analytics at scale | Planned |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, what we accept, and what we don't.

The most valuable contributions right now:

1. **Run audits on real pages** and report false findings or hallucinated recommendations in Issues
2. **Framework compatibility fixes** — the Playwright observer works well on React/Next.js; other frameworks may need tuning
3. **Report template improvements** — clarity, accessibility, mobile rendering
4. **Test coverage** — especially edge cases in the hypothesizer and evaluator

**Before opening a PR:** read the "What We Won't Accept" section in CONTRIBUTING.md. The honesty constraints in the hypothesizer and the visual regression gate are not negotiable.

---

## License

[Apache License 2.0](LICENSE) — free to use, modify, and distribute for any purpose, including commercial use.

---

*Built in public by [BlocWeave](https://blocweave.com).*
