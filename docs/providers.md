# AI Provider Setup

ACO supports three AI providers with automatic fallback. You only need to set the keys for the providers you want to use — ACO picks the first available.

```
Anthropic (Claude) → MIMO → OpenAI
```

---

## Anthropic (Recommended)

Claude is the primary provider. It produces the most consistent, specific, and grounded hypotheses — particularly on the HONESTY constraints (no fabricated metrics, no invented testimonials).

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com).

**Model used:** `claude-sonnet-4-6` for both audits and optimization cycles.

---

## MIMO

MIMO is the second fallback. Set `MIMO_API_KEY` if you have access.

```bash
export MIMO_API_KEY=...
```

---

## OpenAI

OpenAI is the third fallback. GPT-4o is used when Anthropic and MIMO keys are not available.

```bash
export OPENAI_API_KEY=sk-...
```

Note: OpenAI models are more likely to produce generic advice and less likely to respect the honesty constraints strictly. Anthropic is strongly preferred for production use.

---

## Using a .env File

ACO loads `.env` from the current working directory automatically via `dotenv`. Create a `.env` file in your project root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

`.env` is in `.gitignore` by default — do not commit API keys.

---

## Fallback Behavior

If your primary provider fails (rate limit, network error, invalid key), ACO automatically retries with the next available provider in the chain. The provider used for each step is logged in the output.

If no provider is available, ACO exits with a clear error message listing which keys are missing.

---

## Provider Selection Per Operation

| Operation | Model tier | Providers tried |
|---|---|---|
| `aco audit` | quality | Anthropic → MIMO → OpenAI |
| `aco run` (hypothesizer) | quality | Anthropic → MIMO → OpenAI |
| `aco run` (code generator) | quality | Anthropic → MIMO → OpenAI |

All operations use the `quality` tier — there is no "fast/cheap" mode, because the quality of the hypothesis directly determines whether an experiment is worth running.
