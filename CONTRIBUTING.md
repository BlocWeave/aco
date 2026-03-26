# Contributing to ACO

Thank you for your interest in improving ACO. This document covers how to contribute effectively, what kinds of contributions we accept, and what we don't.

## Before You Start

ACO is licensed under **Apache-2.0**. Read [LICENSE](LICENSE) before contributing.

By submitting a pull request, you agree that your contribution is licensed to BlocWeave under the same Apache-2.0 terms.

---

## What We Welcome

### High-value contributions

1. **False positive reports** — run `aco audit <url>` on a real page and open an issue if the hypotheses are generic, fabricated, or miss the actual conversion problem. Include the URL and the report output.

2. **Framework-specific observer fixes** — ACO's Playwright observer works well on React and Next.js. If it produces incorrect DOM extraction on Vue, Nuxt, Svelte, or other frameworks, a targeted fix with a test is very welcome.

3. **Report template improvements** — the HTML report at `src/report/generator.ts` is self-contained. Improvements to readability, accessibility, or mobile rendering are welcome.

4. **Test coverage** — the unit and scenario test suites are in `tests/`. More coverage of edge cases in the hypothesizer and evaluator is useful.

5. **Provider integrations** — adding support for a new AI provider in `src/integrations/providers.ts` following the existing Anthropic → MIMO → OpenAI pattern.

6. **Documentation** — corrections, clarifications, or additions to `README.md` or files in `docs/`.

### What to check before opening a PR

- Is there an existing issue? Search first.
- Is the change small and focused? Large PRs are hard to review — split them.
- Does it pass all tests? (`npm test`)
- Does TypeScript compile? (`npm run typecheck`)

---

## What We Won't Accept

These are firm. PRs in these categories will be closed without review.

### 1. Weakening the honesty constraints

The hypothesizer system prompt (`src/agent/hypothesizer.ts`) contains explicit rules against:

- Fabricating testimonials, user stories, or authority claims
- Inventing conversion lift percentages
- Producing generic advice not grounded in the actual page

We will not accept any change that weakens, removes, or works around these constraints. ACO is used for real business decisions. A CRO tool that makes things up causes real harm.

### 2. Features for a competing hosted service

ACO is a CLI tool. Features designed primarily to support a third-party SaaS offering (e.g., webhook callbacks to an external orchestrator, tenant isolation, billing hooks) are out of scope for this repo. Open an issue to discuss before building.

### 3. Changes to the SaaS

`aco/saas/` is not open source. Only `aco/cli/` is. PRs touching the SaaS directory will be closed.

### 4. Removing safety gates

The visual regression evaluator (`src/agent/evaluator.ts`) exists to prevent broken pages from being committed. Do not remove, weaken, or make it optional without a strong documented reason.

### 5. Prompt injection surface increases

Do not add features that pass unsanitized external content (page copy, user-controlled strings) into the system prompt in ways that could redirect the agent's behavior.

---

## Development Setup

**Requirements:** Node.js 20+, an Anthropic API key

```bash
# Clone the repo
git clone https://github.com/BlocWeave/aco
cd aco/cli

# Install dependencies
npm install

# Install Playwright browsers (required for aco audit and aco run)
npx playwright install chromium

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run in dev mode (no build step)
npm run dev -- audit stripe.com

# Build
npm run build

# Run as installed CLI
./dist/cli.js audit stripe.com
```

---

## Running Tests

```bash
# All unit and integration tests
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage

# Scenario tests (run real audits — requires ANTHROPIC_API_KEY)
npm run test:scenarios
```

Tests are in `tests/unit/` and `tests/scenarios/`. Unit tests are mocked and fast (~1s). Scenario tests make real API calls and cost ~$0.05 per run.

**All tests must pass before a PR is reviewed.** TypeScript must also compile cleanly:

```bash
npm run typecheck
```

---

## Code Style

- TypeScript strict mode. No `any` unless absolutely unavoidable with a comment explaining why.
- ES modules throughout (`import`/`export`, no `require`).
- File-level section comments with `// ─── Section Name ─────` separators (match existing style).
- No external formatting config right now — match the indentation and style of the file you're editing.

---

## Submitting a PR

1. Fork the repo and create a branch: `git checkout -b fix/observer-vue-compat`
2. Make your change with a focused commit message
3. Run `npm test` and `npm run typecheck`
4. Open a PR against `main` with:
   - A clear description of **what** changed and **why**
   - For hypothesis/prompt changes: before/after output on a real URL
   - For observer changes: which framework was broken and how you verified the fix

PRs without test results or with failing checks will be left until they're fixed.

---

## Reporting Issues

Use GitHub Issues for:

- Bug reports (include `aco --version`, Node.js version, OS, and full error output)
- False or fabricated audit findings (include the URL and the problematic hypothesis)
- Feature requests (describe the use case, not just the feature)

Do not open issues for:

- Help with your specific page or conversion funnel — this is a product question, not a bug
- Commercial licensing questions — email [hello@aco.blocweave.com](mailto:hello@aco.blocweave.com)

---

## Questions

For anything not covered here: [hello@aco.blocweave.com](mailto:hello@aco.blocweave.com)
