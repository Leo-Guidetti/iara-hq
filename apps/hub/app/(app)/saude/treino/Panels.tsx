'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AiCard } from '@iara/ui'
import { callFunction } from '@/lib/functions'
import { fmtDay } from '@/lib/dates'

function useRun() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run<T>(label: string, fn: string, body: unknown, after?: (r: T) => void) {
    setBusy(label); setError(null)
    try { const r = await callFunction<T>(fn, body); after?.(r); router.refresh() } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }
  return { busy, error, run }
}

export function CoachPanel({ plan }: { plan: { name: string; rationale: string | null; materialized_through: string | null; progression_rule?: string; flags?: string[]; refs?: string[]; created_at: string } | null }) {
  const { busy, error, run } = useRun()
  const [instruction, setInstruction] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="stack">
      {plan && (
        <AiCard title="Plano de treino" refs={plan.refs} meta={`até ${plan.materialized_through ? fmtDay(plan.materialized_through) : '—'}`}>
          <strong>{plan.name}</strong>
          {plan.rationale && <p className="small">{plan.rationale}</p>}
          {plan.progression_rule && <details className="small"><summary className="muted">Regra de progressão</summary><p>{plan.progression_rule}</p></details>}
          {!!plan.flags?.length && <ul className="small" style={{ color: 'var(--alert)' }}>{plan.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
        </AiCard>
      )}
      <section className="card stack">
        <h2>{plan ? 'Ajustar plano' : 'Criar plano'}</h2>
        <textarea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Opcional: ex. treinar pernas 2x, sem corrida por causa do tornozelo" />
        <div className="grid2">
          <button className="btn ai" disabled={!!busy} onClick={() => run<{ start: string; sessions: number }>('plan', 'claudia-coach', { action: 'plan', instruction }, (r) => { setMsg(`Plano novo a partir de ${fmtDay(r.start)} (${r.sessions} sessões).`); setInstruction('') })}>
            {busy === 'plan' ? 'Montando… (até 1 min)' : plan ? '✦ Gerar novo plano' : '✦ Criar plano'}
          </button>
          {plan && <button className="btn ghost" disabled={!!busy} onClick={() => run<{ created: number; to: string }>('extend', 'claudia-coach', { action: 'extend', days: 7 }, (r) => setMsg(`${r.created} sessões até ${fmtDay(r.to)}.`))}>{busy === 'extend' ? 'Estendendo…' : '+ 1 semana'}</button>}
        </div>
        <p className="small muted">O plano novo começa depois da última sessão já planejada; nada do que existe é apagado.</p>
        {msg && <p className="small" style={{ color: 'var(--progress)' }}>{msg}</p>}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  )
}

type Proposal = { kind: 'session' | 'template'; session_id?: number; strength_day_index?: number; why: string; patch: { title?: string; duration_min?: number; notes?: string; exercises?: { name: string; sets: number; reps: string; load_kg?: number | null }[] } }
export type ReviewRow = { id: number; week_start: string; payload: { summary?: string; signals?: { area: string; level: string; text: string }[]; proposals?: Proposal[]; refs?: string[] }; decisions: Record<string, { decision: string } | undefined> }

export function ReviewPanel({ review }: { review: ReviewRow | null }) {
  const { busy, error, run } = useRun()
  const p = review?.payload
  return (
    <div className="stack">
      {review && (
        <AiCard title="Revisão semanal" refs={p?.refs} meta={`semana de ${fmtDay(review.week_start)}`}>
          <p>{p?.summary}</p>
          {!!p?.signals?.length && <ul className="small">{p.signals.map((s) => <li key={s.text} style={{ color: s.level === 'warn' ? 'var(--alert)' : undefined }}>{s.text}</li>)}</ul>}
          {(p?.proposals ?? []).map((pr, i) => {
            const d = review.decisions?.[i]?.decision
            return (
              <div key={i} className="card" style={{ background: 'var(--surface-2)', marginTop: 8 }}>
                <span className="tag ai">{pr.kind === 'session' ? `Sessão #${pr.session_id}` : `Modelo: dia de força ${(pr.strength_day_index ?? 0) + 1}`}</span>
                <p className="small">{pr.why}</p>
                {pr.patch.exercises && <ul className="small muted">{pr.patch.exercises.map((e) => <li key={e.name}>{e.name} {e.sets}×{e.reps}{e.load_kg ? ` · ${e.load_kg} kg` : ''}</li>)}</ul>}
                {pr.patch.title && <p className="small muted">Título: {pr.patch.title}{pr.patch.duration_min ? ` · ${pr.patch.duration_min} min` : ''}</p>}
                {d ? <span className={`tag ${d === 'accept' ? 'progress' : ''}`}>{d === 'accept' ? '✓ aplicada' : 'descartada'}</span> : (
                  <div className="grid2">
                    <button className="btn" disabled={!!busy} onClick={() => run(`a${i}`, 'claudia-coach-review', { action: 'apply', review_id: review.id, index: i, decision: 'accept' })}>{busy === `a${i}` ? 'Aplicando…' : 'Aplicar'}</button>
                    <button className="btn ghost" disabled={!!busy} onClick={() => run(`r${i}`, 'claudia-coach-review', { action: 'apply', review_id: review.id, index: i, decision: 'reject' })}>Descartar</button>
                  </div>
                )}
              </div>
            )
          })}
        </AiCard>
      )}
      <button className="btn ai" disabled={!!busy} onClick={() => run('review', 'claudia-coach-review', { action: 'review' })}>{busy === 'review' ? 'Revisando… (até 1 min)' : '✦ Revisar última semana'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export type CheckinRow = { week_start: string; score: number | null; payload: { headline?: string; narrative?: string; wins?: string[]; watch_outs?: string[]; next_steps?: { text: string; why: string }[]; focus_of_week?: string; refs?: string[] } }
export function CheckinPanel({ checkin }: { checkin: CheckinRow | null }) {
  const { busy, error, run } = useRun()
  const p = checkin?.payload
  return (
    <div className="stack">
      {checkin && (
        <AiCard title="Check-in semanal" refs={p?.refs} meta={`semana de ${fmtDay(checkin.week_start)}`}>
          <div className="row"><div className="kpi num">{checkin.score}</div><span className="muted">/100</span></div>
          <strong>{p?.headline}</strong>
          <p className="small">{p?.narrative}</p>
          {!!p?.wins?.length && <><h2>Foi bem</h2><ul className="small">{p.wins.map((w) => <li key={w}>{w}</li>)}</ul></>}
          {!!p?.watch_outs?.length && <><h2>Atenção</h2><ul className="small" style={{ color: 'var(--alert)' }}>{p.watch_outs.map((w) => <li key={w}>{w}</li>)}</ul></>}
          {!!p?.next_steps?.length && <><h2>Próximos passos</h2><ul className="small">{p.next_steps.map((n) => <li key={n.text}>{n.text} <span className="muted">— {n.why}</span></li>)}</ul></>}
          {p?.focus_of_week && <p><span className="tag progress">Foco</span> {p.focus_of_week}</p>}
        </AiCard>
      )}
      <button className="btn ai" disabled={!!busy} onClick={() => run('c', 'claudia-checkin', {})}>{busy ? 'Fazendo check-in…' : '✦ Check-in da última semana'}</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

export function StravaPanel({ status }: { status: { connected: boolean; athlete_name?: string; last_sync_at?: string | null } | null }) {
  const { busy, error, run } = useRun()
  const [msg, setMsg] = useState<string | null>(null)
  async function connect() {
    const state = crypto.randomUUID()
    try { sessionStorage.setItem('strava_state', state) } catch {}
    await run<{ url: string }>('connect', 'claudia-strava', { action: 'connect', redirect_uri: `${location.origin}/saude/treino/strava`, state }, (r) => { location.href = r.url })
  }
  return (
    <section className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Strava</h2>{status?.connected ? <span className="tag progress">conectado</span> : <span className="small muted">desconectado</span>}</div>
      {status?.connected ? (
        <>
          <p className="small muted">{status.athlete_name} · último sync {status.last_sync_at ? new Date(status.last_sync_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}</p>
          <div className="grid2">
            <button className="btn" disabled={!!busy} onClick={() => run<{ imported: number; linked: number }>('sync', 'claudia-strava', { action: 'sync' }, (r) => setMsg(`${r.imported} atividades lidas, ${r.linked} ligadas ao plano.`))}>{busy === 'sync' ? 'Sincronizando…' : 'Sincronizar'}</button>
            <button className="btn ghost" disabled={!!busy} onClick={() => { if (confirm('Desconectar apaga os tokens e as atividades importadas do Strava. Continuar?')) run('disc', 'claudia-strava', { action: 'disconnect' }) }}>Desconectar</button>
          </div>
        </>
      ) : <button className="btn" disabled={!!busy} onClick={connect}>{busy ? 'Abrindo Strava…' : 'Conectar Strava'}</button>}
      {msg && <p className="small" style={{ color: 'var(--progress)' }}>{msg}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
