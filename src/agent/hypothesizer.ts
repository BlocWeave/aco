import { callWithFallback } from '../integrations/providers.js'
import {
  AuditResponseSchema,
  CIALDINI_PRINCIPLES,
  PRINCIPLE_DESCRIPTIONS,
  type AuditResponse,
  type PageObservation,
  type AcoConfig,
} from '../types.js'
import type { TokenUsage } from '../integrations/claude.js'

// ─── System Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a world-class conversion rate optimization (CRO) analyst. Your reports are used by real businesses to make real investment decisions. Inaccurate, generic, or fabricated advice causes harm — be rigorous.

Your expertise:
- Robert Cialdini's principles of persuasion (Influence, Pre-Suasion)
- Landing page psychology and UX friction reduction
- Copywriting (David Ogilvy, Eugene Schwartz, Gary Halbert frameworks)
- Statistical experimentation methodology

Your job: analyze this specific landing page and produce page-specific, actionable hypotheses for improving conversion rates. Every finding must be grounded in what is actually present on this page — not what pages in this category typically need.

CRITICAL RULES:

HONESTY
1. Never claim specific conversion lift percentages or projected outcomes — you have no access to this site's traffic data. The 'estimated_impact' field is your confidence that the change will have a detectable effect if tested, not a lift prediction. Never write phrases like "could increase conversions by X%" or "projected to lift CVR by Y%".
2. Be brutally honest in scores. A score of 7/10 should be genuinely good. A page that looks professional but has weak copy and no social proof is a 4-5, not a 7-8.
3. NO FABRICATED CONTENT: Never invent example testimonials, fake authority quotes, or made-up user stories to illustrate a recommendation. Do not write things like "Add a testimonial such as 'This product changed my life — I improved results by 30%!'" You do not know what real customers say. If recommending to add testimonials, say: "Add real customer testimonials here. Collect them via email/survey then display 2-3 with names and use cases."
4. NO INVENTED METRICS: Never suggest fabricated social proof numbers ("Trusted by 10,000+ users"). You don't know actual numbers. Instead: tell the user to insert their real numbers once available, using placeholders like "[X] customers" or "[Y] companies."
5. NO INVENTED AUTHORITY: Never fabricate claims about who uses the product ("Used by Fortune 500 companies", "Trusted by Amazon sellers"). Only reference authority that is actually present on the page.

SPECIFICITY
6. Every hypothesis 'issue' and 'recommendation' MUST reference actual elements on this page — quote the real headline, name the exact CTA button text, describe a specific section that is visible. Generic advice that could apply to any landing page is not acceptable.
7. For each hypothesis: state WHY this specific page has this problem (not just that it's a common CRO issue). What specific evidence from the page supports the finding?
8. CONTRAST PRINCIPLE: Every recommendation must state the before and after. For copy changes: 'Current: "[exact current text]" → Proposed: "[specific alternative]"'. For structural changes: 'Current: [describe what exists] → Proposed: [describe exactly what to add/change and where]'.

QUALITY
9. Prioritize by impact × implementability. Bias toward high-probability incremental improvements (single copy change, single CTA tweak) over exploratory bets (layout restructure, new section). A reliable 2% lift compounds; a speculative 20% lift usually doesn't exist.
10. ONE FACTOR AT A TIME (OFAT): Each hypothesis must change exactly ONE element. Never bundle multiple changes into one test — if you bundle 3 changes and the experiment wins, you can't know which change caused the improvement. If a full-page redesign seems warranted, decompose it into separate atomic hypotheses.
11. NO DUPLICATE FINDINGS: Each hypothesis addresses a distinct problem. If two issues relate to the same root cause (e.g., both about lack of trust), merge them into one stronger, more nuanced hypothesis that covers the full problem space.
12. 'quick_wins' must be achievable in under 30 minutes by a developer — no design sprints, no copy overhauls.
13. 'what_is_working' must be specific, evidence-based observations about this page — not generic praise ("clean design", "clear CTA"). Name what specifically works and why it works psychologically.

Cialdini Principles you apply:
${Object.entries(PRINCIPLE_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Additional frameworks:
- Eugene Schwartz awareness levels: Unaware → Problem-aware → Solution-aware → Product-aware → Most-aware
- Jobs-to-be-done: What is the visitor trying to accomplish on this page?
- Cognitive load theory: Every extra element competes for attention
- Above-the-fold principle: The most important content must be visible without scrolling`

// ─── Build User Message ───────────────────────────────────────────────────

function buildAuditPrompt(observation: PageObservation, program?: AcoConfig): string {
  const { url, title, metaDescription, dom, coreWebVitals, accessibility } = observation

  const sections = [
    `## Page Being Analyzed\nURL: ${url}\nTitle: ${title}\nMeta Description: ${metaDescription || '(none)'}`,

    `## Above-the-Fold Content\nH1: ${dom.headline || '(none)'}\nH2/Subtitle: ${dom.subheadline || '(none)'}\nPrimary CTA: ${dom.primaryCta || '(none)'}`,

    `## All CTAs on Page\n${dom.ctaText.length > 0 ? dom.ctaText.map(t => `- "${t}"`).join('\n') : '(none found)'}`,

    `## Form Fields\n${dom.formFields.length > 0 ? dom.formFields.map(f => `- ${f}`).join('\n') : '(no forms)'}`,

    `## Social Proof Elements\n${dom.socialProof.length > 0 ? dom.socialProof.slice(0, 5).map(s => `- "${s.slice(0, 200)}"`).join('\n') : '(none found)'}`,

    `## Trust Signals\n${dom.trustSignals.length > 0 ? dom.trustSignals.map(t => `- "${t}"`).join('\n') : '(none found)'}`,

    `## Page Metadata\nWord count: ${dom.wordCount} words\nHas video: ${dom.hasVideo}\nHas chat widget: ${dom.hasChat}\nNav items: ${dom.navItems.join(', ') || '(none)'}\nPage structure: ${dom.pageStructure || '(unclear)'}`,

    coreWebVitals.lcp || coreWebVitals.fcp || coreWebVitals.ttfb
      ? `## Performance\nLCP: ${coreWebVitals.lcp ? `${coreWebVitals.lcp}ms` : 'n/a'}\nFCP: ${coreWebVitals.fcp ? `${coreWebVitals.fcp}ms` : 'n/a'}\nTTFB: ${coreWebVitals.ttfb ? `${coreWebVitals.ttfb}ms` : 'n/a'}`
      : null,

    accessibility.length > 0
      ? `## Accessibility Issues Found\n${accessibility.slice(0, 5).map(a => `- [${a.severity}] ${a.type}: ${a.description}`).join('\n')}`
      : null,

    dom.pricingInfo
      ? `## Pricing Section\n${dom.pricingInfo.slice(0, 400)}`
      : null,

    program
      ? `## Brand Context (from aco.md)\nBrand: ${program.brand.name}\nValue proposition: ${program.brand.valueProposition ?? '(not specified)'}\nPrimary conversion goal: ${program.goals.primaryConversionGoal}\nTarget audience: ${program.brand.audience ?? '(not specified)'}\nTone: ${program.brand.tone ?? '(not specified)'}`
      : null,
  ]

  return sections.filter(Boolean).join('\n\n')
}

// ─── Hypothesizer ─────────────────────────────────────────────────────────

export interface HypothesizerResult {
  audit: AuditResponse
  usage: TokenUsage
}

export async function generateHypotheses(
  observation: PageObservation,
  program?: AcoConfig
): Promise<HypothesizerResult> {
  const userMessage = buildAuditPrompt(observation, program)

  // Build messages array — include screenshot for multimodal analysis
  const messages: Parameters<typeof callWithFallback>[0]['messages'] = [
    {
      role: 'user',
      content: [
        // Vision: send screenshot for visual analysis
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: observation.screenshotBase64,
          },
        },
        {
          type: 'text',
          text: `I need a full CRO audit for this landing page. Here is the extracted page data:\n\n${userMessage}\n\nAnalyze both the visual screenshot above AND the extracted data. Generate honest, actionable conversion optimization hypotheses.`,
        },
      ],
    },
  ]

  const { result, usage } = await callWithFallback({
    modelTier: 'quality',
    system: SYSTEM_PROMPT,
    messages,
    toolName: 'submit_cro_audit',
    toolDescription: `Submit the complete CRO audit with hypotheses and scores. IMPORTANT: The 'principle' field on each hypothesis MUST be one of these exact values: ${CIALDINI_PRINCIPLES.join(', ')}. No other values are accepted.`,
    schema: AuditResponseSchema,
    maxTokens: 8192,
  })

  // Assign stable IDs to hypotheses
  const auditWithIds: AuditResponse = {
    ...result,
    hypotheses: result.hypotheses.map((h, i) => ({
      ...h,
      id: `H${String(i + 1).padStart(2, '0')}`,
    })),
  }

  return { audit: auditWithIds, usage }
}
