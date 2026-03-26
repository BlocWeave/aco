import { chromium } from 'playwright'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type {
  PageObservation,
  DomSummary,
  CoreWebVitals,
  AccessibilityIssue,
} from '../types.js'

// ─── DOM Extraction ───────────────────────────────────────────────────────

async function extractDomSummary(page: import('playwright').Page): Promise<DomSummary> {
  return page.evaluate(() => {
    const text = (el: Element | null): string => el?.textContent?.trim() ?? ''
    const texts = (sel: string): string[] =>
      Array.from(document.querySelectorAll(sel))
        .map(el => el.textContent?.trim() ?? '')
        .filter(t => t.length > 0)

    // CTAs: all buttons and prominent links
    const ctaElements = Array.from(document.querySelectorAll(
      'button, a[href], input[type="submit"], input[type="button"], [role="button"]'
    ))
    const ctaText = ctaElements
      .map(el => (el as HTMLElement).innerText?.trim() || el.getAttribute('value') || el.getAttribute('aria-label') || '')
      .filter(t => t.length > 0 && t.length < 100)
      .slice(0, 15)

    // Primary CTA — first above-the-fold button or .cta / .btn-primary style element
    const primaryCtaEl = document.querySelector(
      '.cta, .btn-primary, [class*="primary"], [class*="cta"], button[type="submit"], .hero button, .hero a'
    ) ?? document.querySelector('button, a.button, input[type="submit"]')
    const primaryCta = primaryCtaEl
      ? (primaryCtaEl as HTMLElement).innerText?.trim() || primaryCtaEl.getAttribute('value') || null
      : null

    // Forms
    const formFields = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'))
      .map(el => {
        const label = document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
        return label || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('aria-label') || ''
      })
      .filter(t => t.length > 0)

    // Social proof: testimonials, review counts, trust logos
    const socialProofSelectors = [
      '[class*="testimonial"]', '[class*="review"]', '[class*="customer"]',
      '[class*="trust"]', '[class*="logo"]', 'blockquote',
      '[class*="rating"]', '[class*="star"]', '[class*="social-proof"]',
    ]
    const socialProof = Array.from(document.querySelectorAll(socialProofSelectors.join(', ')))
      .map(el => el.textContent?.trim() ?? '')
      .filter(t => t.length > 5 && t.length < 500)
      .slice(0, 10)

    // Trust signals
    const trustSelectors = [
      '[class*="secure"]', '[class*="guarantee"]', '[class*="ssl"]',
      '[class*="badge"]', '[class*="cert"]', '[alt*="secure"]',
      '[alt*="ssl"]', '[alt*="guarantee"]',
    ]
    const trustSignals = Array.from(document.querySelectorAll(trustSelectors.join(', ')))
      .map(el => el.getAttribute('alt') || el.textContent?.trim() || '')
      .filter(t => t.length > 0 && t.length < 200)
      .slice(0, 8)

    // Pricing section
    const pricingEl = document.querySelector('[class*="pricing"], [id*="pricing"], [class*="price"]')
    const pricingInfo = pricingEl ? (pricingEl as HTMLElement).innerText?.slice(0, 500) ?? null : null

    // Page structure description
    const sections = Array.from(document.querySelectorAll('section, [class*="section"], [class*="hero"], [class*="feature"], main > div'))
    const pageStructure = sections
      .slice(0, 8)
      .map(s => s.getAttribute('class') || s.tagName)
      .join(' → ')

    // Word count
    const bodyText = document.body.innerText ?? ''
    const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length

    return {
      headline: text(document.querySelector('h1')),
      subheadline: text(document.querySelector('h2, [class*="subtitle"], [class*="sub-headline"]')),
      ctaText,
      primaryCta,
      formFields,
      socialProof,
      trustSignals,
      pricingInfo,
      wordCount,
      hasVideo: document.querySelector('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="loom"]') !== null,
      hasChat: document.querySelector('[class*="intercom"], [class*="crisp"], [class*="drift"], [class*="chat"]') !== null,
      navItems: texts('nav a, header a').slice(0, 10),
      pageStructure,
    } satisfies DomSummary
  })
}

// ─── Core Web Vitals ──────────────────────────────────────────────────────

async function measureCoreWebVitals(page: import('playwright').Page): Promise<CoreWebVitals> {
  try {
    const vitals = await page.evaluate(() => {
      return new Promise<Partial<CoreWebVitals>>((resolve) => {
        const result: Partial<CoreWebVitals> = {}

        // FCP via PerformanceObserver
        if ('PerformanceObserver' in window) {
          try {
            const fcpObserver = new PerformanceObserver((list) => {
              const entries = list.getEntriesByName('first-contentful-paint')
              if (entries[0]) result.fcp = Math.round(entries[0].startTime)
            })
            fcpObserver.observe({ entryTypes: ['paint'] })
          } catch { /* not supported */ }

          try {
            const lcpObserver = new PerformanceObserver((list) => {
              const entries = list.getEntries()
              const last = entries[entries.length - 1]
              if (last) result.lcp = Math.round(last.startTime)
            })
            lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] })
          } catch { /* not supported */ }
        }

        // TTFB from Navigation Timing
        const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        if (navEntry) {
          result.ttfb = Math.round(navEntry.responseStart - navEntry.requestStart)
        }

        setTimeout(() => resolve(result), 3000)
      })
    })

    return {
      lcp: vitals.lcp ?? null,
      fid: null,  // FID requires real user interaction
      cls: null,  // CLS requires scroll/interaction simulation
      fcp: vitals.fcp ?? null,
      ttfb: vitals.ttfb ?? null,
      performanceScore: null,  // Full Lighthouse requires separate invocation
    }
  } catch {
    return { lcp: null, fid: null, cls: null, fcp: null, ttfb: null, performanceScore: null }
  }
}

// ─── Accessibility ────────────────────────────────────────────────────────

async function checkAccessibility(page: import('playwright').Page): Promise<AccessibilityIssue[]> {
  return page.evaluate(() => {
    const issues: AccessibilityIssue[] = []

    // Images without alt text
    document.querySelectorAll('img').forEach(img => {
      if (!img.getAttribute('alt') && !img.getAttribute('aria-label')) {
        issues.push({
          type: 'missing_alt',
          element: img.outerHTML.slice(0, 120),
          description: 'Image missing alt text — screen readers cannot describe this to visually impaired users',
          severity: 'warning',
        })
      }
    })

    // Form inputs without labels
    document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea').forEach(input => {
      const id = input.getAttribute('id')
      const hasLabel = id && document.querySelector(`label[for="${id}"]`) !== null
      const hasAria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby')
      if (!hasLabel && !hasAria) {
        issues.push({
          type: 'missing_label',
          element: input.outerHTML.slice(0, 120),
          description: 'Form field missing label — hurts both accessibility and SEO',
          severity: 'critical',
        })
      }
    })

    // Missing H1
    if (document.querySelectorAll('h1').length === 0) {
      issues.push({
        type: 'missing_heading',
        element: 'page',
        description: 'Page has no H1 heading — critical for SEO and page structure',
        severity: 'critical',
      })
    }

    // Multiple H1s
    if (document.querySelectorAll('h1').length > 1) {
      issues.push({
        type: 'missing_heading',
        element: 'page',
        description: `Page has ${document.querySelectorAll('h1').length} H1 headings — should have exactly one`,
        severity: 'warning',
      })
    }

    return issues.slice(0, 20)
  }) as Promise<AccessibilityIssue[]>
}

// ─── Main Observer ────────────────────────────────────────────────────────

export interface ObserveOptions {
  mobile?: boolean
  timeoutMs?: number
}

export async function observePage(url: string, options: ObserveOptions = {}): Promise<PageObservation> {
  const { mobile = false, timeoutMs = 30_000 } = options

  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      userAgent: mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      javaScriptEnabled: true,
    })

    const page = await context.newPage()

    // Navigate with reasonable timeout
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    })

    // Let animations settle
    await page.waitForTimeout(1500)

    const screenshotDir = path.join(os.tmpdir(), 'aco-screenshots')
    await fs.mkdir(screenshotDir, { recursive: true })
    const ts = Date.now()
    const screenshotPath = path.join(screenshotDir, `${ts}.png`)

    // Viewport screenshot for Claude (above-the-fold is the most analytically useful
    // area for CRO, and full-page PNGs can exceed Anthropic's 5 MB image limit).
    const viewportBuffer = await page.screenshot({ fullPage: false })
    const screenshotBase64 = viewportBuffer.toString('base64')

    // Full-page screenshot saved to disk for the HTML report display.
    await page.screenshot({ path: screenshotPath, fullPage: true })

    // Parallel extraction
    const [dom, coreWebVitals, accessibility, title, metaDescription] = await Promise.all([
      extractDomSummary(page),
      measureCoreWebVitals(page),
      checkAccessibility(page),
      page.title(),
      page.$eval('meta[name="description"]', el => el.getAttribute('content') ?? '').catch(() => ''),
    ])

    return {
      url,
      screenshotBase64,
      screenshotPath,
      title,
      metaDescription,
      dom,
      coreWebVitals,
      accessibility,
      capturedAt: new Date(),
    }
  } finally {
    await browser.close()
  }
}
