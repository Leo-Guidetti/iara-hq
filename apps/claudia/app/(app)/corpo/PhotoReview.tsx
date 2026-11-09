'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AiCard } from '@/components/AiCard'
import { callFunction } from '@/lib/functions'
import { fmtDay } from '@/lib/dates'

export type ReviewRow = {
  id: number; created_at: string; baseline_date: string | null; current_date_ref: string
  bf_low: number | null; bf_high: number | null; confidence: string | null; protocol_consistent: boolean | null
  summary: string | null; observations: { changes?: string[]; caveats?: string[]; next_photo_tips?: string[]; refs?: string[] } | null
  model: string; prompt_version: string
}
const CONF: Record<string, string> = { low: 'baixa', medium: 'média', high: 'alta' }

export function PhotoReview({ last, dates }: { last: ReviewRow | null; dates: string[] }) {
  const router = useRouter()
  const [base, setBase] = useState(dates[0] ?? '')
  const [cur, setCur] = useState(dates.at(-1) ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null)
    try {
      await callFunction('claudia-photo-review', { baseline_date: base, current_date: cur })
      router.refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const o = last?.observations ?? {}
  return (
    <div className="stack">
      {last && (
        <AiCard title="Análise das fotos" refs={o.refs} meta={`${fmtDay(last.current_date_ref)}${last.baseline_date ? ` vs ${fmtDay(last.baseline_date)}` : ''}`}>
          <div className="kpi num">{last.bf_low?.toString().replace('.', ',')}–{last.bf_high?.toString().replace('.', ',')}%</div>
          <p className="small muted">gordura estimada · confiança {CONF[last.confidence ?? ''] ?? '—'}
            {last.protocol_consistent === false && <span className="tag alert" style={{ marginLeft: 8 }}>protocolo diferente</span>}
          </p>
          <p>{last.summary}</p>
          {!!o.changes?.length && (<><h2>Mudanças</h2><ul>{o.changes.map((c) => <li key={c}>{c}</li>)}</ul></>)}
          {!!o.caveats?.length && (<><h2>Ressalvas</h2><ul className="muted">{o.caveats.map((c) => <li key={c}>{c}</li>)}</ul></>)}
          {!!o.next_photo_tips?.length && (<><h2>Próximas fotos</h2><ul className="muted">{o.next_photo_tips.map((c) => <li key={c}>{c}</li>)}</ul></>)}
        </AiCard>
      )}
      {dates.length > 0 && (
        <section className="card stack">
          <h2>Nova análise</h2>
          <div className="grid2">
            <label>Referência<select value={base} onChange={(e) => setBase(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}</select></label>
            <label>Atual<select value={cur} onChange={(e) => setCur(e.target.value)}>{dates.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}</select></label>
          </div>
          <button className="btn ai" onClick={run} disabled={busy}>{busy ? 'Analisando… (até 1 min)' : 'Analisar com IA'}</button>
          {error && <p className="error">{error}</p>}
        </section>
      )}
    </div>
  )
}
