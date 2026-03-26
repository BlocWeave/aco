import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PageObservation, AuditResponse, Hypothesis, CialdianiPrinciple } from '../types.js'
import type { TokenUsage } from '../integrations/claude.js'

// ─── Colour palette per principle ────────────────────────────────────────

const PRINCIPLE_COLORS: Record<CialdianiPrinciple, { bg: string; text: string; border: string; label: string }> = {
  reciprocity:   { bg: '#fef3c7', text: '#92400e', border: '#f59e0b', label: 'Reciprocity' },
  commitment:    { bg: '#ede9fe', text: '#5b21b6', border: '#8b5cf6', label: 'Commitment' },
  social_proof:  { bg: '#d1fae5', text: '#065f46', border: '#10b981', label: 'Social Proof' },
  authority:     { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6', label: 'Authority' },
  scarcity:      { bg: '#fee2e2', text: '#991b1b', border: '#ef4444', label: 'Scarcity' },
  urgency:       { bg: '#fee2e2', text: '#991b1b', border: '#ef4444', label: 'Urgency' },
  liking:        { bg: '#fce7f3', text: '#9d174d', border: '#ec4899', label: 'Liking' },
  unity:         { bg: '#ffedd5', text: '#9a3412', border: '#f97316', label: 'Unity' },
  clarity:       { bg: '#f0fdf4', text: '#166534', border: '#22c55e', label: 'Clarity' },
  trust:         { bg: '#f0f9ff', text: '#0c4a6e', border: '#0ea5e9', label: 'Trust' },
}

const PRIORITY_COLORS: Record<Hypothesis['priority'], { bg: string; text: string }> = {
  critical: { bg: '#fee2e2', text: '#991b1b' },
  high:     { bg: '#ffedd5', text: '#9a3412' },
  medium:   { bg: '#fef9c3', text: '#854d0e' },
  low:      { bg: '#f3f4f6', text: '#374151' },
}

const EFFORT_LABELS: Record<Hypothesis['effort'], string> = {
  copy_only:        '✍️ Copy only',
  style_change:     '🎨 Style change',
  layout_change:    '📐 Layout change',
  structural_change: '🏗️ Structural',
}

// ─── Score Arc SVG ────────────────────────────────────────────────────────

function scoreArc(score: number, label: string, size = 100): string {
  const radius = 38
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - score / 10)
  const color = score >= 7 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444'

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="8"/>
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${color}" stroke-width="8"
        stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
        stroke-linecap="round" style="transition:stroke-dashoffset 1s ease"/>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" style="transform:rotate(90deg);transform-origin:${cx}px ${cy}px;font-size:18px;font-weight:700;fill:#111827;">${score}</text>
    </svg>
    <div style="font-size:11px;color:#6b7280;margin-top:4px;text-align:center;">${label}</div>
  `
}

// ─── Hypothesis Card ──────────────────────────────────────────────────────

function hypothesisCard(h: Hypothesis, index: number): string {
  const principle = PRINCIPLE_COLORS[h.principle]
  const priority = PRIORITY_COLORS[h.priority]

  return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:16px;border-left:4px solid ${principle.border};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="background:#111827;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;letter-spacing:0.05em;">${h.id}</span>
          <span style="background:${principle.bg};color:${principle.text};border:1px solid ${principle.border};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;">${principle.label}</span>
          <span style="background:${priority.bg};color:${priority.text};font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;text-transform:capitalize;">${h.priority}</span>
        </div>
        <span style="color:#6b7280;font-size:12px;white-space:nowrap;">${EFFORT_LABELS[h.effort]}</span>
      </div>

      <div style="margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:4px;">Element</div>
        <div style="font-size:15px;font-weight:600;color:#111827;">${escapeHtml(h.element)}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div style="background:#fef2f2;border-radius:8px;padding:14px;">
          <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">❌ Current State</div>
          <div style="font-size:13px;color:#374151;line-height:1.5;">${escapeHtml(h.current_state)}</div>
        </div>
        <div style="background:#f0fdf4;border-radius:8px;padding:14px;">
          <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">✅ Recommendation</div>
          <div style="font-size:13px;color:#374151;line-height:1.5;font-weight:500;">${escapeHtml(h.recommendation)}</div>
        </div>
      </div>

      <div style="background:#f8fafc;border-radius:8px;padding:14px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">🧠 Why This Works</div>
        <div style="font-size:13px;color:#374151;line-height:1.6;">${escapeHtml(h.why_it_works)}</div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding-top:12px;border-top:1px solid #f3f4f6;">
        <div style="font-size:12px;color:#6b7280;">
          📊 <strong>Measure:</strong> ${escapeHtml(h.metric_to_track)}
        </div>
        <div style="font-size:12px;color:#6b7280;" title="The agent's confidence this hypothesis will have a detectable effect — not a lift prediction">
          Confidence: <strong style="color:${h.estimated_impact === 'high' ? '#059669' : h.estimated_impact === 'medium' ? '#d97706' : '#6b7280'};">${h.estimated_impact === 'high' ? 'High' : h.estimated_impact === 'medium' ? 'Medium' : 'Low'}</strong>
        </div>
      </div>
    </div>
  `
}

// ─── HTML Escape ──────────────────────────────────────────────────────────

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Constants ───────────────────────────────────────────────────────────

const MODELS_USED = 'claude-sonnet-4-6'

// ─── Main Report Builder ──────────────────────────────────────────────────

export interface ReportInput {
  observation: PageObservation
  audit: AuditResponse
  usage: TokenUsage
}

export async function generateReport(input: ReportInput, outputPath?: string): Promise<string> {
  const { observation, audit, usage } = input
  const { url, screenshotBase64, title, capturedAt } = observation
  const scores = audit.conversion_score

  const formattedDate = capturedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const overallColor = scores.overall >= 7 ? '#22c55e' : scores.overall >= 5 ? '#f59e0b' : '#ef4444'
  const overallLabel = scores.overall >= 7 ? 'Good' : scores.overall >= 5 ? 'Needs Work' : 'Poor'

  const criticalCount = audit.hypotheses.filter(h => h.priority === 'critical').length
  const highCount = audit.hypotheses.filter(h => h.priority === 'high').length

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACO Audit — ${escapeHtml(title || url)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111827; line-height: 1.6; }
    a { color: inherit; text-decoration: none; }
    @media (max-width: 768px) {
      .scores-grid { grid-template-columns: repeat(2, 1fr) !important; }
      .two-col { grid-template-columns: 1fr !important; }
      .header-meta { flex-direction: column !important; align-items: flex-start !important; }
    }
    @media print {
      body { background: #fff; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>

<!-- ── Header ─────────────────────────────────────────────────────────── -->
<div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;padding:40px 0 0;">
  <div style="max-width:900px;margin:0 auto;padding:0 24px;">

    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
      <div style="background:#3b82f6;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;">⚡</div>
      <span style="font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;">ACO — Autonomous Conversion Optimizer</span>
    </div>

    <h1 style="font-size:clamp(22px,4vw,32px);font-weight:800;margin-bottom:8px;line-height:1.2;">
      CRO Audit Report
    </h1>
    <p style="font-size:14px;color:#94a3b8;margin-bottom:24px;">
      ${escapeHtml(url)} &nbsp;·&nbsp; ${formattedDate}
    </p>

    <!-- Overall score banner -->
    <div style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:24px;margin-bottom:32px;">
      <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
        <div style="text-align:center;">
          <div style="font-size:56px;font-weight:900;color:${overallColor};line-height:1;">${scores.overall}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px;">/ 10 overall</div>
          <div style="font-size:13px;font-weight:700;color:${overallColor};margin-top:4px;">${overallLabel}</div>
        </div>
        <div style="flex:1;min-width:200px;">
          <p style="font-size:15px;color:#e2e8f0;line-height:1.7;margin-bottom:12px;">${escapeHtml(audit.overall_assessment)}</p>
          ${criticalCount > 0 || highCount > 0 ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              ${criticalCount > 0 ? `<span style="background:#fee2e2;color:#991b1b;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">${criticalCount} critical issue${criticalCount > 1 ? 's' : ''}</span>` : ''}
              ${highCount > 0 ? `<span style="background:#ffedd5;color:#9a3412;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">${highCount} high-priority</span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    </div>

    <!-- Tab nav (print-friendly sections) -->
    <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);">
      ${['Scores', 'Top Finding', 'Hypotheses', 'Quick Wins', 'Screenshot'].map((tab, i) =>
        `<a href="#section-${i}" style="padding:12px 20px;font-size:13px;font-weight:600;color:${i === 0 ? '#93c5fd' : '#64748b'};border-bottom:2px solid ${i === 0 ? '#3b82f6' : 'transparent'};margin-bottom:-1px;">${tab}</a>`
      ).join('')}
    </div>
  </div>
</div>

<!-- ── Main Content ────────────────────────────────────────────────────── -->
<div style="max-width:900px;margin:0 auto;padding:32px 24px;">

  <!-- Scores Grid -->
  <div id="section-0" style="margin-bottom:40px;">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:20px;color:#111827;">Conversion Readiness Scores</h2>
    <div class="scores-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
      ${[
        { label: 'Clarity', score: scores.clarity },
        { label: 'Trust', score: scores.trust },
        { label: 'Urgency', score: scores.urgency },
        { label: 'Social Proof', score: scores.social_proof },
      ].map(({ label, score }) => {
        const color = score >= 7 ? '#22c55e' : score >= 5 ? '#f59e0b' : '#ef4444'
        return `
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;">
            <div style="font-size:40px;font-weight:900;color:${color};line-height:1;">${score}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:6px;">${label}</div>
            <div style="background:#f3f4f6;border-radius:4px;height:4px;margin-top:8px;">
              <div style="background:${color};height:4px;border-radius:4px;width:${score * 10}%;transition:width 0.8s ease;"></div>
            </div>
          </div>
        `
      }).join('')}
    </div>
  </div>

  <!-- Top Finding -->
  <div id="section-1" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:40px;border-left:4px solid #ef4444;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
      <span style="font-size:20px;">🎯</span>
      <h2 style="font-size:16px;font-weight:700;color:#111827;">The #1 Conversion Problem</h2>
    </div>
    <p style="font-size:15px;color:#374151;line-height:1.7;">${escapeHtml(audit.top_finding)}</p>
  </div>

  <!-- Hypotheses -->
  <div id="section-2" style="margin-bottom:40px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <h2 style="font-size:18px;font-weight:700;color:#111827;">
        ${audit.hypotheses.length} Testable Hypotheses
      </h2>
      <p style="font-size:13px;color:#6b7280;max-width:440px;">
        Each is a specific, falsifiable prediction grounded in conversion psychology. These are experiments waiting to be run — not projected outcomes. Measure the listed metric with real traffic before drawing any conclusions.
      </p>
    </div>
    ${audit.hypotheses.map((h, i) => hypothesisCard(h, i)).join('')}
  </div>

  <!-- Quick Wins -->
  <div id="section-3" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:40px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <span style="font-size:20px;">⚡</span>
      <h2 style="font-size:16px;font-weight:700;color:#111827;">Quick Wins (Under 30 Minutes Each)</h2>
    </div>
    <ol style="margin:0;padding-left:20px;">
      ${audit.quick_wins.map(w => `
        <li style="font-size:14px;color:#374151;margin-bottom:10px;line-height:1.6;">${escapeHtml(w)}</li>
      `).join('')}
    </ol>
  </div>

  <!-- What's Working -->
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:24px;margin-bottom:40px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
      <span style="font-size:20px;">✅</span>
      <h2 style="font-size:16px;font-weight:700;color:#166534;">What's Already Working</h2>
    </div>
    <ul style="margin:0;padding-left:20px;">
      ${audit.what_is_working.map(w => `
        <li style="font-size:14px;color:#374151;margin-bottom:10px;line-height:1.6;">${escapeHtml(w)}</li>
      `).join('')}
    </ul>
  </div>

  <!-- Page Screenshot -->
  <div id="section-4" style="margin-bottom:40px;">
    <h2 style="font-size:18px;font-weight:700;margin-bottom:16px;color:#111827;">Page Screenshot (at audit time)</h2>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#f8fafc;border-bottom:1px solid #e5e7eb;padding:12px 16px;display:flex;align-items:center;gap:8px;">
        <div style="width:10px;height:10px;border-radius:50%;background:#ef4444;"></div>
        <div style="width:10px;height:10px;border-radius:50%;background:#f59e0b;"></div>
        <div style="width:10px;height:10px;border-radius:50%;background:#22c55e;"></div>
        <span style="font-size:12px;color:#9ca3af;margin-left:8px;">${escapeHtml(url)}</span>
      </div>
      <img src="data:image/png;base64,${screenshotBase64}"
           alt="Screenshot of ${escapeHtml(url)}"
           style="width:100%;display:block;max-height:800px;object-fit:cover;object-position:top;"
           loading="lazy">
    </div>
  </div>

  <!-- Accessibility Issues -->
  ${observation.accessibility.length > 0 ? `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:40px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <span style="font-size:20px;">♿</span>
        <h2 style="font-size:16px;font-weight:700;color:#111827;">Accessibility Issues (${observation.accessibility.length})</h2>
      </div>
      ${observation.accessibility.map(a => `
        <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6;">
          <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;white-space:nowrap;align-self:start;background:${a.severity === 'critical' ? '#fee2e2' : '#fef9c3'};color:${a.severity === 'critical' ? '#991b1b' : '#854d0e'};">${a.severity}</span>
          <div>
            <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:2px;">${a.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</div>
            <div style="font-size:13px;color:#6b7280;">${escapeHtml(a.description)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : ''}

  <!-- Footer -->
  <div style="border-top:1px solid #e5e7eb;padding-top:24px;text-align:center;">
    <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:8px;">
      <div style="background:#3b82f6;width:24px;height:24px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;">⚡</div>
      <span style="font-weight:700;color:#111827;">ACO</span>
      <span style="color:#6b7280;font-size:13px;">— Autonomous Conversion Optimizer</span>
    </div>
    <p style="font-size:12px;color:#9ca3af;margin-bottom:4px;">
      Report generated using Claude ${MODELS_USED} · ${usage.totalTokens.toLocaleString()} tokens · ~$${usage.estimatedCostUsd.toFixed(4)} cost
    </p>
    <p style="font-size:12px;color:#9ca3af;">
      These are <strong>untested hypotheses</strong>. The agent has no access to your traffic data and makes no
      prediction about conversion lift. Validate every change with a controlled A/B test before drawing conclusions.
    </p>
    <div style="margin-top:16px;">
      <a href="https://github.com/BlocWeave/aco" style="font-size:12px;color:#3b82f6;">github.com/BlocWeave/aco</a>
      <span style="color:#d1d5db;margin:0 8px;">·</span>
      <span style="font-size:12px;color:#9ca3af;">Open source · Apache-2.0</span>
    </div>
  </div>

</div>

<script>
  // Smooth scroll for tab nav links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault()
      const target = document.querySelector(a.getAttribute('href'))
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
</script>
</body>
</html>`

  const resolvedPath = outputPath ?? path.join(process.cwd(), 'aco-report.html')
  await fs.writeFile(resolvedPath, html, 'utf-8')
  return resolvedPath
}
