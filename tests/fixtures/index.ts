/**
 * Shared test fixtures — minimal but realistic data used across tests.
 * All fixtures are valid against their Zod schemas.
 */

import type { PageObservation, AuditResponse, Hypothesis } from '../../src/types.js'

export const MOCK_HYPOTHESIS: Hypothesis = {
  id: 'H01',
  principle: 'social_proof',
  element: 'Hero section testimonials',
  current_state: 'No testimonials or customer logos above the fold',
  issue: 'Visitors arrive with no external validation that this product works. Without social proof, conversion anxiety is high.',
  recommendation: 'Add 3 one-line customer quotes directly under the headline, followed by a row of 5 recognisable customer logos.',
  why_it_works: 'Social proof (Cialdini) reduces perceived risk. Seeing peers succeed lowers the psychological cost of taking action.',
  metric_to_track: 'Hero CTA click-through rate',
  priority: 'critical',
  effort: 'copy_only',
  estimated_impact: 'high',
}

export const MOCK_HYPOTHESIS_HIGH: Hypothesis = {
  id: 'H02',
  principle: 'clarity',
  element: 'Primary CTA button',
  current_state: '"Get Started" — generic, no value signal',
  issue: 'Vague CTAs create commitment anxiety. The visitor does not know what happens next.',
  recommendation: 'Change to "Start Your Free Trial — No Credit Card" to add specificity and remove a common objection.',
  why_it_works: 'Commitment principle: reducing the perceived size of the first step increases willingness to take it.',
  metric_to_track: 'CTA click-through rate',
  priority: 'high',
  effort: 'copy_only',
  estimated_impact: 'high',
}

export const MOCK_HYPOTHESIS_MEDIUM: Hypothesis = {
  id: 'H03',
  principle: 'authority',
  element: 'About section',
  current_state: 'Founder bio without credentials or publication mentions',
  issue: 'No authority signals mean the visitor has no reason to trust the brand over competitors.',
  recommendation: 'Add "As seen in" logos (TechCrunch, Product Hunt) and specific customer outcome stats.',
  why_it_works: 'Authority signals (Cialdini) allow visitors to trust by proxy — third-party endorsement reduces evaluation cost.',
  metric_to_track: 'Time on page and scroll depth past About section',
  priority: 'medium',
  effort: 'style_change',
  estimated_impact: 'medium',
}

export const MOCK_AUDIT_RESPONSE: AuditResponse = {
  overall_assessment: 'This page has a clear value proposition but suffers from weak social proof and a generic CTA that reduces visitor confidence at the moment of decision.',
  conversion_score: {
    overall: 5,
    clarity: 6,
    trust: 4,
    urgency: 3,
    social_proof: 3,
  },
  top_finding: 'The hero section has no social proof. Visitors arrive cold with no validation the product works. This is the highest-leverage change available.',
  hypotheses: [MOCK_HYPOTHESIS, MOCK_HYPOTHESIS_HIGH, MOCK_HYPOTHESIS_MEDIUM, {
    id: 'H04',
    principle: 'scarcity',
    element: 'Pricing section',
    current_state: 'No urgency signals — plan prices displayed with no time context',
    issue: 'Without any urgency, visitors defer decisions indefinitely.',
    recommendation: 'Add a genuine urgency signal: "Early access pricing — locks in forever." Only use if this is actually true.',
    why_it_works: 'Scarcity principle triggers loss aversion, a more powerful motivator than potential gain.',
    metric_to_track: 'Pricing section CTA click rate',
    priority: 'low',
    effort: 'copy_only',
    estimated_impact: 'low',
  }],
  quick_wins: [
    'Change the primary CTA from "Get Started" to "Start Free Trial — No Credit Card"',
    'Add 3 customer logos directly below the headline',
    'Replace the about section stock photo with a real team photo',
  ],
  what_is_working: [
    'The headline clearly states the product category — no ambiguity about what the company does',
    'Mobile layout is clean with no horizontal scroll or overflow',
  ],
}

export const MOCK_PAGE_OBSERVATION: PageObservation = {
  url: 'https://example.com',
  screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  screenshotPath: '/tmp/aco-screenshots/test.png',
  title: 'Example SaaS — Build faster',
  metaDescription: 'The fastest way to build modern web applications.',
  dom: {
    headline: 'Build faster with Example',
    subheadline: 'The modern development platform for ambitious teams',
    ctaText: ['Get Started', 'View Docs', 'Sign In', 'Start Free Trial'],
    primaryCta: 'Get Started',
    formFields: ['Email address', 'Password'],
    socialProof: [],
    trustSignals: [],
    pricingInfo: 'Starter $29/mo · Pro $99/mo · Enterprise custom',
    wordCount: 843,
    hasVideo: false,
    hasChat: true,
    navItems: ['Product', 'Pricing', 'Docs', 'Blog', 'Sign In'],
    pageStructure: 'hero → features → pricing → testimonials → footer',
  },
  coreWebVitals: {
    lcp: 1850,
    fid: null,
    cls: null,
    fcp: 920,
    ttfb: 180,
    performanceScore: null,
  },
  accessibility: [
    {
      type: 'missing_alt',
      element: '<img src="/hero.png" class="hero-image">',
      description: 'Image missing alt text — screen readers cannot describe this to visually impaired users',
      severity: 'warning',
    },
  ],
  capturedAt: new Date('2026-03-11T10:00:00Z'),
}
