import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as http from 'node:http'
import { observePage } from '../../src/agent/observer.js'

// ─── Local test server ────────────────────────────────────────────────────
// We serve deterministic HTML so observer tests never depend on external URLs.
// This eliminates network flakiness and makes every assertion exact.

const TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="The best way to automate your workflow">
  <title>Test SaaS — Build faster</title>
</head>
<body>
  <nav>
    <a href="/product">Product</a>
    <a href="/pricing">Pricing</a>
    <a href="/docs">Docs</a>
    <a href="/signin">Sign In</a>
  </nav>

  <section class="hero">
    <h1>Build faster with Test SaaS</h1>
    <h2>The modern platform for ambitious teams</h2>
    <a href="/signup" class="btn-primary">Start Free Trial</a>
    <p>No credit card required</p>
  </section>

  <section class="social-proof">
    <div class="testimonial">"This saved us 20 hours a week" — Sarah, CTO at Acme</div>
    <div class="logo">Logo 1</div>
    <div class="logo">Logo 2</div>
  </section>

  <section class="features">
    <h2>Why teams choose us</h2>
    <p>200+ integrations, zero config</p>
  </section>

  <section class="pricing">
    <h2>Simple pricing</h2>
    <p>Starter $29/mo · Pro $99/mo</p>
  </section>

  <section>
    <form action="/signup" method="post">
      <label for="email">Email address</label>
      <input id="email" type="email" name="email" placeholder="you@company.com">
      <label for="password">Password</label>
      <input id="password" type="password" name="password">
      <button type="submit">Create Account</button>
    </form>
  </section>

  <!-- Image without alt — should trigger a11y warning -->
  <img src="/hero.png">

  <!-- Extra buttons for CTA extraction -->
  <button>Learn More</button>
  <a href="/demo">Book a Demo</a>
</body>
</html>`

const ACCESSIBLE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Accessible Page</title></head>
<body>
  <h1>Accessible Heading</h1>
  <img src="/logo.png" alt="Company logo">
  <form>
    <label for="name">Your name</label>
    <input id="name" type="text" name="name">
  </form>
</body>
</html>`

// ─── Server lifecycle ─────────────────────────────────────────────────────

let server: http.Server
let baseUrl: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    if (req.url === '/accessible') {
      res.end(ACCESSIBLE_HTML)
    } else {
      res.end(TEST_HTML)
    }
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => err ? reject(err) : resolve())
  )
})

// ─── Tests ────────────────────────────────────────────────────────────────

describe('observePage', () => {
  describe('basic capture', () => {
    it('returns the correct URL', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.url).toBe(baseUrl)
    })

    it('captures the page title', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.title).toBe('Test SaaS — Build faster')
    })

    it('captures the meta description', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.metaDescription).toBe('The best way to automate your workflow')
    })

    it('returns a non-empty base64 screenshot', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.screenshotBase64.length).toBeGreaterThan(100)
      // A valid base64 string only contains these characters
      expect(obs.screenshotBase64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('returns a screenshot file path that exists', async () => {
      const obs = await observePage(baseUrl)
      const { access } = await import('node:fs/promises')
      await expect(access(obs.screenshotPath)).resolves.toBeUndefined()
    })

    it('records a capturedAt timestamp', async () => {
      const before = new Date()
      const obs = await observePage(baseUrl)
      const after = new Date()
      expect(obs.capturedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(obs.capturedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    })
  })

  describe('DOM extraction', () => {
    it('extracts the H1 headline', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.headline).toBe('Build faster with Test SaaS')
    })

    it('extracts the H2 subheadline', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.subheadline).toBeDefined()
      expect(obs.dom.subheadline?.length).toBeGreaterThan(0)
    })

    it('extracts CTA text including the primary button', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.ctaText).toContain('Start Free Trial')
    })

    it('identifies the primary CTA', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.primaryCta).toBeTruthy()
    })

    it('extracts form field labels', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.formFields.length).toBeGreaterThan(0)
      // Labels are present in the test HTML
      const allFields = obs.dom.formFields.join(' ')
      expect(allFields.toLowerCase()).toMatch(/email|password/)
    })

    it('extracts social proof elements', async () => {
      const obs = await observePage(baseUrl)
      // testimonial + logo divs should be captured
      expect(obs.dom.socialProof.length).toBeGreaterThan(0)
    })

    it('captures nav items', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.navItems).toContain('Product')
      expect(obs.dom.navItems).toContain('Pricing')
    })

    it('extracts pricing info when present', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.pricingInfo).toBeTruthy()
      expect(obs.dom.pricingInfo).toContain('$')
    })

    it('counts words greater than zero', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.wordCount).toBeGreaterThan(10)
    })

    it('detects absence of video', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.dom.hasVideo).toBe(false)
    })
  })

  describe('accessibility audit', () => {
    it('detects missing alt text on images', async () => {
      const obs = await observePage(baseUrl)
      const missing = obs.accessibility.filter(a => a.type === 'missing_alt')
      expect(missing.length).toBeGreaterThan(0)
    })

    it('reports no alt-text issues on a fully accessible page', async () => {
      const obs = await observePage(`${baseUrl}/accessible`)
      const missing = obs.accessibility.filter(a => a.type === 'missing_alt')
      expect(missing.length).toBe(0)
    })

    it('reports no label issues when inputs have proper labels', async () => {
      const obs = await observePage(`${baseUrl}/accessible`)
      const missingLabels = obs.accessibility.filter(a => a.type === 'missing_label')
      expect(missingLabels.length).toBe(0)
    })

    it('returns accessibility issues as an array', async () => {
      const obs = await observePage(baseUrl)
      expect(Array.isArray(obs.accessibility)).toBe(true)
    })

    it('each issue has type, element, description, and severity', async () => {
      const obs = await observePage(baseUrl)
      for (const issue of obs.accessibility) {
        expect(issue.type).toBeDefined()
        expect(issue.element).toBeDefined()
        expect(issue.description).toBeDefined()
        expect(['critical', 'warning']).toContain(issue.severity)
      }
    })
  })

  describe('Core Web Vitals', () => {
    it('returns a coreWebVitals object', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.coreWebVitals).toBeDefined()
    })

    it('has null for FID (requires real user interaction)', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.coreWebVitals.fid).toBeNull()
    })

    it('has null for CLS (requires scroll simulation)', async () => {
      const obs = await observePage(baseUrl)
      expect(obs.coreWebVitals.cls).toBeNull()
    })
  })

  describe('mobile viewport', () => {
    it('captures successfully on mobile viewport', async () => {
      const obs = await observePage(baseUrl, { mobile: true })
      expect(obs.screenshotBase64.length).toBeGreaterThan(100)
      expect(obs.dom.headline).toBe('Build faster with Test SaaS')
    })
  })

  describe('error handling', () => {
    it('throws on an unreachable URL', async () => {
      await expect(observePage('http://127.0.0.1:1', { timeoutMs: 3000 }))
        .rejects.toThrow()
    })

    it('throws on an invalid protocol', async () => {
      await expect(observePage('ftp://invalid', { timeoutMs: 3000 }))
        .rejects.toThrow()
    })
  })
}, { timeout: 30_000 })
