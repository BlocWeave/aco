import { z } from 'zod'

// ─── Cialdini Principles ───────────────────────────────────────────────────

export const CIALDINI_PRINCIPLES = [
  'reciprocity',
  'commitment',
  'social_proof',
  'authority',
  'scarcity',
  'urgency',   // Alias for scarcity focused on time pressure — GPT models prefer this term
  'liking',
  'unity',
  'clarity',   // Not Cialdini but essential — friction from unclear messaging
  'trust',     // Trust signals: SSL, guarantees, privacy, brand
] as const

export type CialdianiPrinciple = typeof CIALDINI_PRINCIPLES[number]

export const PRINCIPLE_DESCRIPTIONS: Record<CialdianiPrinciple, string> = {
  reciprocity: 'Give value before asking — free trial, free resource, free consultation',
  commitment: 'Reduce commitment anxiety — match ask to trust level, small steps first',
  social_proof: 'Show others doing it — testimonials, logos, counts, ratings',
  authority: 'Demonstrate expertise — credentials, press mentions, certifications',
  scarcity: 'Limited time/availability — real urgency, not fake timers',
  urgency: 'Time-limited action — deadlines, expiry, now-or-never framing',
  liking: 'People buy from people they like — personality, tone, faces',
  unity: 'Us vs them framing — shared identity, community belonging',
  clarity: 'Remove cognitive friction — clear headline, obvious next step',
  trust: 'Safety signals — guarantees, privacy, security badges',
}

// ─── Page Observation ─────────────────────────────────────────────────────

export interface PageObservation {
  url: string
  screenshotBase64: string     // Full-page screenshot, base64 PNG
  screenshotPath: string       // Path to saved screenshot file
  title: string
  metaDescription: string
  dom: DomSummary
  coreWebVitals: CoreWebVitals
  accessibility: AccessibilityIssue[]
  capturedAt: Date
}

export interface DomSummary {
  headline: string | null        // h1
  subheadline: string | null     // h2 or hero subtitle
  ctaText: string[]              // All button/link text on page
  primaryCta: string | null      // Most prominent CTA
  formFields: string[]           // All form field labels/placeholders
  socialProof: string[]          // Testimonial text, logos, counts
  trustSignals: string[]         // Badges, guarantees, certifications
  pricingInfo: string | null     // Pricing section text if present
  wordCount: number
  hasVideo: boolean
  hasChat: boolean
  navItems: string[]
  pageStructure: string          // Brief description of layout sections
}

export interface CoreWebVitals {
  lcp: number | null             // Largest Contentful Paint (ms)
  fid: number | null             // First Input Delay (ms)
  cls: number | null             // Cumulative Layout Shift (score)
  fcp: number | null             // First Contentful Paint (ms)
  ttfb: number | null            // Time to First Byte (ms)
  performanceScore: number | null  // Lighthouse 0-100
}

export interface AccessibilityIssue {
  type: 'missing_alt' | 'low_contrast' | 'missing_label' | 'missing_heading' | 'keyboard_trap' | 'other'
  element: string
  description: string
  severity: 'critical' | 'warning'
}

// ─── Hypothesis ───────────────────────────────────────────────────────────

export const HypothesisSchema = z.object({
  id: z.string(),
  principle: z.enum(CIALDINI_PRINCIPLES),
  element: z.string().describe('The specific element or section being targeted (e.g., "hero CTA button", "pricing section headline")'),
  current_state: z.string().describe('What the element currently does or says'),
  issue: z.string().describe('Why this is likely hurting conversions — the psychological or UX problem'),
  recommendation: z.string().describe('Specific, actionable change to make — concrete words or design direction'),
  why_it_works: z.string().describe('The conversion psychology reasoning behind this recommendation'),
  metric_to_track: z.string().describe('The specific metric that should improve if this hypothesis is correct'),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  effort: z.enum(['copy_only', 'style_change', 'layout_change', 'structural_change']),
  estimated_impact: z.enum(['high', 'medium', 'low']).describe('Agent confidence that this hypothesis will have a detectable positive effect if tested. High = strong theoretical support from multiple principles. NOT a lift prediction — the agent has no traffic data.'),
})

export type Hypothesis = z.infer<typeof HypothesisSchema>

export const AuditResponseSchema = z.object({
  overall_assessment: z.string().describe('2-3 sentence honest assessment of the page\'s conversion readiness'),
  conversion_score: z.object({
    overall: z.number().min(1).max(10),
    clarity: z.number().min(1).max(10),
    trust: z.number().min(1).max(10),
    urgency: z.number().min(1).max(10),
    social_proof: z.number().min(1).max(10),
  }).describe('Scores 1-10 — be honest, not generous'),
  top_finding: z.string().describe('The single most important conversion problem on this page'),
  hypotheses: z.array(HypothesisSchema).min(4).max(8),
  quick_wins: z.array(z.string()).describe('3-5 changes that take under 30 minutes and should be done immediately'),
  what_is_working: z.array(z.string()).describe('2-4 things the page does well — be specific'),
})

export type AuditResponse = z.infer<typeof AuditResponseSchema>

// ─── aco.md (Brand Soul) ──────────────────────────────────────────────────

export interface AcoConfig {
  brand: {
    name: string
    tagline?: string
    tone?: string
    audience?: string
    valueProposition?: string
  }
  goals: {
    primaryConversionGoal: string
    secondaryGoals?: string[]
  }
  constraints: {
    allowedChangeCategories: ('copy' | 'cta' | 'social_proof' | 'layout' | 'structure')[]
    brandVoice?: string
    thingsToNeverChange?: string[]
  }
  targetUrl?: string
}

// ─── Phase 1: Optimization Loop Types ────────────────────────────────────

export const CHANGE_CATEGORIES = ['copy', 'cta', 'social_proof', 'layout', 'structure'] as const
export type ChangeCategory = typeof CHANGE_CATEGORIES[number]

export const ChangeSpecSchema = z.object({
  hypothesisId: z.string(),
  category: z.enum(CHANGE_CATEGORIES),
  filePath: z.string(),
  description: z.string(),
  searchText: z.string().min(1),
  replacementText: z.string().min(1),
  lineHint: z.number().int().optional(),
  reasoning: z.string(),
})

export type ChangeSpec = z.infer<typeof ChangeSpecSchema>

export const ChangeSpecArraySchema = z.object({
  changes: z.array(ChangeSpecSchema).max(3),
  skipped: z.boolean(),
  skipReason: z.string().optional(),
})

export type ChangeSpecArray = z.infer<typeof ChangeSpecArraySchema>

// ─── Experiment Result (one line in results.jsonl) ────────────────────────

export const ExperimentOutcomeSchema = z.enum(['accepted', 'rejected', 'skipped', 'error', 'reverted'])
export type ExperimentOutcome = z.infer<typeof ExperimentOutcomeSchema>

export const ExperimentResultSchema = z.object({
  experimentId: z.string(),
  runId: z.string(),
  timestamp: z.string(),
  hypothesisId: z.string(),
  category: z.enum(CHANGE_CATEGORIES),
  filePath: z.string(),
  searchText: z.string(),
  replacementText: z.string(),
  outcome: ExperimentOutcomeSchema,
  reason: z.string(),
  visualSimilarity: z.number().optional(),
  gitCommitHash: z.string().optional(),
  costUsd: z.number(),
  cumulativeRunCostUsd: z.number(),
  provider: z.string(),
  modelUsed: z.string(),
  changes: z.array(ChangeSpecSchema).optional(),
})

export type ExperimentResult = z.infer<typeof ExperimentResultSchema>

// ─── Budget Config ─────────────────────────────────────────────────────────

export const BudgetConfigSchema = z.object({
  maxUsd: z.number().positive(),
  warnAtUsd: z.number().positive().optional(),
  maxExperimentsPerRun: z.number().int().positive().optional(),
})

export type BudgetConfig = z.infer<typeof BudgetConfigSchema>

export const DEFAULT_BUDGET: BudgetConfig = {
  maxUsd: 2.00,
  warnAtUsd: 1.00,
  maxExperimentsPerRun: 10,
}
