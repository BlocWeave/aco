import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../../src/report/generator.js'

describe('escapeHtml', () => {
  describe('XSS prevention — each dangerous character', () => {
    it('escapes ampersand &', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
    })

    it('escapes less-than <', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
    })

    it('escapes greater-than >', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b')
    })

    it('escapes double quote "', () => {
      expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;')
    })

    it("escapes single quote '", () => {
      expect(escapeHtml("it's fine")).toBe('it&#39;s fine')
    })
  })

  describe('XSS attack vectors', () => {
    it('neutralises a script injection', () => {
      const payload = '<script>alert("xss")</script>'
      const result = escapeHtml(payload)
      expect(result).not.toContain('<script>')
      expect(result).not.toContain('</script>')
      expect(result).toContain('&lt;script&gt;')
    })

    it('neutralises an event handler injection', () => {
      const payload = '" onmouseover="alert(1)'
      const result = escapeHtml(payload)
      expect(result).not.toContain('"')
      expect(result).toContain('&quot;')
    })

    it('neutralises a URL-based injection', () => {
      const payload = "javascript:alert('xss')"
      const result = escapeHtml(payload)
      expect(result).not.toContain("'")
    })

    it('neutralises nested tags', () => {
      const payload = '<img src=x onerror=alert(1)>'
      const result = escapeHtml(payload)
      expect(result).not.toContain('<img')
      expect(result).toContain('&lt;img')
    })
  })

  describe('safe passthrough', () => {
    it('returns an empty string unchanged', () => {
      expect(escapeHtml('')).toBe('')
    })

    it('returns plain text unchanged', () => {
      expect(escapeHtml('Hello world')).toBe('Hello world')
    })

    it('preserves numbers and punctuation that are safe', () => {
      expect(escapeHtml('Score: 7.5/10 — excellent!')).toBe('Score: 7.5/10 — excellent!')
    })

    it('preserves newlines and whitespace', () => {
      expect(escapeHtml('line 1\nline 2')).toBe('line 1\nline 2')
    })

    it('handles long strings without truncation', () => {
      const long = 'a'.repeat(10_000)
      expect(escapeHtml(long)).toBe(long)
    })
  })

  describe('multiple replacements in one string', () => {
    it('replaces all occurrences, not just the first', () => {
      const result = escapeHtml('& & &')
      expect(result).toBe('&amp; &amp; &amp;')
    })

    it('handles a string with all five special characters', () => {
      const result = escapeHtml('<"it\'s a test & check">')
      expect(result).toBe('&lt;&quot;it&#39;s a test &amp; check&quot;&gt;')
    })
  })
})
