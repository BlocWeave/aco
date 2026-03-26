# aco.md Reference

`aco.md` is the file that tells ACO who you are, what you're optimizing for, and what it's allowed to touch. It's the human-maintained document that grounds every AI decision in your specific context.

Run `aco init` to scaffold a template, then edit it.

---

## Why It Exists

Without `aco.md`, ACO has no context:

- It doesn't know what a "conversion" is on your site (a signup? a purchase? a demo request?)
- It doesn't know your brand voice — it might suggest copy that doesn't sound like you
- It doesn't know what's off-limits — pricing, legal text, compliance copy

With `aco.md`, ACO produces hypotheses that are grounded in your actual goals and respects constraints you've set.

---

## Structure

```markdown
# Brand

**Name:** [Your brand name]
**Value proposition:** [One sentence — what do you do and for whom?]
**Audience:** [Who is your primary visitor? Be specific: "early-stage SaaS founders", not "businesses"]
**Tone:** [e.g., "Direct and confident, no fluff", "Friendly but expert", "Premium and reserved"]

---

# Conversion Goal

**Primary goal:** [Exactly what counts as a conversion — be precise]
**Secondary goal (optional):** [e.g., email capture, demo request]

Examples of good primary goals:
- "User completes the signup form and reaches the /welcome page"
- "User clicks the 'Book a demo' button"
- "User adds a product to cart"

Examples of bad primary goals:
- "More conversions" (too vague)
- "Increase revenue" (not a page-level event)

---

# What ACO Can Change

List the categories of changes the agent is permitted to make. Be explicit — anything not listed here will be ignored.

- [ ] Headline copy (H1, H2)
- [ ] CTA button text
- [ ] Supporting copy (subheadlines, body paragraphs)
- [ ] Social proof placement and framing
- [ ] Trust signal copy
- [ ] Form field labels and placeholder text
- [ ] Navigation link text

---

# Constraints — Do Not Touch

ACO will never modify the following, regardless of what it thinks might improve conversion:

- Pricing (amounts, trial lengths, plan names)
- Legal text (terms, privacy policy, cookie notice)
- [Add anything specific to your business here]

---

# Context

Optional: anything else ACO should know that isn't obvious from the page.

- Seasonal context: [e.g., "We run a promotion in November — do not add urgency copy in other months"]
- Known issues: [e.g., "Mobile traffic converts 40% lower — prioritize mobile UX hypotheses"]
- Traffic source: [e.g., "Most traffic arrives from Google Ads targeting 'project management software'"]
- Prior tests: [e.g., "We tested a red CTA button vs blue — blue won. Don't suggest color changes."]
```

---

## Tips

**Be specific about your primary goal.** The more precise you are, the more targeted the hypotheses. "User completes the signup form and reaches /welcome" is better than "signup". ACO needs to know exactly what behavior constitutes success.

**List constraints explicitly.** Pricing and legal are obvious — but you may have other constraints. Brand-specific elements ("never move the founder photo from above the fold"), regulatory language, or product names that must not be changed.

**Update it as you learn.** After a few experiment cycles, you'll know which hypotheses the agent keeps generating that you always reject. Add those to your constraints. After you've shipped a winning copy change, note it in context so ACO builds on it rather than reverting.

**The audience line matters.** "Early-stage SaaS founders running teams of 2–10" produces much more specific hypotheses than "businesses". ACO uses this to calibrate the awareness level (are visitors problem-aware? product-aware?) and tone.

---

## Example: Real aco.md

```markdown
# Brand

**Name:** Clearline
**Value proposition:** Automated invoice reconciliation for e-commerce businesses with Shopify + QuickBooks.
**Audience:** E-commerce operators running Shopify stores doing $500K–$5M/year who are manually reconciling invoices.
**Tone:** Practical and direct. No marketing speak. Readers are operators, not investors.

---

# Conversion Goal

**Primary goal:** User clicks "Start free trial" and completes the 3-step onboarding (store connection step).

---

# What ACO Can Change

- Headline copy (H1, H2)
- CTA button text and subtext
- Supporting copy under the hero
- Social proof section (testimonial framing, not the testimonials themselves — those are real)
- FAQ copy

---

# Constraints — Do Not Touch

- Pricing table (any amount, any plan name)
- The three customer testimonials (exact text — we have permission for these specific quotes)
- The Shopify and QuickBooks partner logos and badge copy
- Cookie notice and privacy policy links

---

# Context

- Most traffic is from Google Ads targeting "shopify quickbooks integration" — visitors are solution-aware, not product-aware
- Mobile traffic is less than 15% — desktop is primary
- We've tested: "Start free trial" vs "Try it free" on the CTA — "Start free trial" won by 12% (do not retest CTA text)
```

---

## What Happens Without aco.md

ACO runs without it — the agent falls back to general CRO principles. Hypotheses will still be grounded in what's on the page (ACO always analyzes the actual elements), but they won't be calibrated to your conversion goal or constrained by your business rules. For serious optimization, `aco.md` is worth the 10 minutes it takes to write.
