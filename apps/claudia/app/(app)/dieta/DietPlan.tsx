'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AiCard } from '@/components/AiCard'
import { callFunction } from '@/lib/functions'
import { fmtDay } from '@/lib/dates'

type Payload = {
  summary?: string; rationale?: string
  tdee?: { tdee?: number; method?: string; note?: string; daysWithKcal?: number; windowDays?: number }
  targets?: { kcal?: number; proteinG?: number; proteinRange?: number[]; deficit?: number }
  day_targets?: { day: string; tipo?: string; treino?: string; kcal: number; protein_g: number; carbs_g?: number; fat_g?: number }[]
  protein_distribution?: { meal: string; protein_g: number; examples?: string[] }[]
  hydration_fiber?: string[]; low_appetite_strategies?: string[]; flags?: string[]; refs?: string[]
}
export type DietRow = { id: number; created_at: string; kcal_target: number | null; protein_g_target: number | null; tdee_estimate: number | null; tdee_method: string | null; rationale: string | null; payload: Payload; prompt_version: string | null }

export function DietPlan({ last }: { last: DietRow | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true); setError(null)
    try { await callFunction('claudia-diet', {}); router.refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const p = last?.payload ?? {}
  const List = ({ t, xs }: { t: string; xs?: string[] }) => (xs?.length ? <><h2>{t}</h2><ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul></> : null)
  return (
    <div className="stack">
      {last && (
        <AiCard title="Plano alimentar" refs={p.refs} meta={fmtDay(last.created_at.slice(0, 10))}>
          <div className="grid2">
            <div><div className="kpi num">{last.kcal_target}</div><span className="small muted">kcal/dia (teto)</span></div>
            <div><div className="kpi num">{last.protein_g_target} g</div><span className="small muted">proteína/dia (meta)</span></div>
          </div>
          <p className="small muted">TDEE {last.tdee_estimate} kcal · {last.tdee_method === 'adaptive' ? 'adaptativo' : 'fórmula'} · déficit {p.targets?.deficit ?? '—'} kcal</p>
          {p.tdee?.note && <p className="small muted">{p.tdee.note}</p>}
          <p>{p.summary}</p>
          {!!p.flags?.length && <div className="card alert" style={{ background: 'transparent' }}><span className="tag alert">Atenção</span><ul>{p.flags.map((f) => <li key={f}>{f}</li>)}</ul></div>}
          {!!p.day_targets?.length && (
            <><h2>Semana</h2><div className="list small">{p.day_targets.map((d) => (
              <div key={d.day} className="row between"><span style={{ textTransform: 'capitalize' }}>{d.day}<span className="muted"> · {d.treino || d.tipo}</span></span><span className="num">{d.kcal} kcal · {d.protein_g} g</span></div>
            ))}</div></>
          )}
          {!!p.protein_distribution?.length && (
            <><h2>Proteína por refeição</h2><div className="list small">{p.protein_distribution.map((d) => (
              <div key={d.meal}><div className="row between"><strong>{d.meal}</strong><span className="num">{d.protein_g} g</span></div><span className="muted">{d.examples?.join(' · ')}</span></div>
            ))}</div></>
          )}
          <List t="Com pouco apetite" xs={p.low_appetite_strategies} />
          <List t="Água e fibra" xs={p.hydration_fiber} />
          {last.rationale && <details><summary className="muted">Racional</summary><p>{last.rationale}</p></details>}
        </AiCard>
      )}
      <button className="btn ai" onClick={run} disabled={busy}>{busy ? 'Calculando plano… (até 1 min)' : last ? '✦ Recalcular plano' : '✦ Gerar plano alimentar'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
