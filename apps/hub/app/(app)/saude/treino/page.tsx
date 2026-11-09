import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import { addDays, fmtDay, spDate } from '@/lib/dates'
import { CoachPanel, ReviewPanel, CheckinPanel, StravaPanel, type ReviewRow, type CheckinRow } from './Panels'
import { SPORT_PT, INTENSITY_PT, StatusChip } from './ui'

export const dynamic = 'force-dynamic'
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
const monday = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7))

export default async function TreinoPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const me = (await currentUser())!
  const today = spDate()
  const { w } = await searchParams
  const ws = monday(w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : today)
  const we = addDays(ws, 6)
  const [{ data: sessions }, { data: acts }, { data: plan }, { data: review }, { data: checkin }, { data: tp }, { data: strava }] = await Promise.all([
    me.sb.from('plan_sessions').select('id, local_date, sport, title, intensity, duration_min, distance_km, status, edited').gte('local_date', ws).lte('local_date', we).order('local_date').order('id'),
    me.sb.from('activities').select('id, local_date, sport, title, duration_min, distance_km, avg_hr, source, plan_session_id').gte('local_date', ws).lte('local_date', we).order('started_at'),
    me.sb.from('workout_plans').select('plan, rationale, materialized_through, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('coach_reviews').select('id, week_start, payload, decisions').order('week_start', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('weekly_checkins').select('week_start, score, payload').order('week_start', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('training_profiles').select('user_id').eq('user_id', me.user.id).maybeSingle(),
    me.sb.rpc('strava_status'),
  ])
  const p = plan?.plan as { name?: string; progression_rule?: string; flags?: string[]; refs?: string[] } | undefined
  const done = (sessions ?? []).filter((s) => s.status === 'done').length

  return (
    <div className="stack">
      <div className="row between">
        <h1>Treino</h1>
        <Link href="/saude/treino/perfil" className="btn ghost">Perfil de treino</Link>
      </div>
      {!tp && <div className="card alert"><span className="tag alert">Falta perfil</span><p>Preencha o <Link href="/saude/treino/perfil" style={{ textDecoration: 'underline' }}>perfil de treino</Link> para o coach montar o plano.</p></div>}

      <section className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <Link className="btn ghost" href={`/saude/treino?w=${addDays(ws, -7)}`} aria-label="semana anterior">‹</Link>
          <div style={{ textAlign: 'center' }}><strong>{fmtDay(ws)} – {fmtDay(we)}</strong><div className="small muted">{done}/{sessions?.length ?? 0} feitas</div></div>
          <Link className="btn ghost" href={`/saude/treino?w=${addDays(ws, 7)}`} aria-label="próxima semana">›</Link>
        </div>
        <div className="list">
          {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d, i) => {
            const day = (sessions ?? []).filter((s) => s.local_date === d)
            const extra = (acts ?? []).filter((a) => a.local_date === d && !a.plan_session_id)
            return (
              <div key={d} style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, background: d === today ? 'color-mix(in srgb, var(--progress) 8%, transparent)' : undefined, borderRadius: 8 }}>
                <div className="small muted" style={{ paddingTop: 2 }}>{WD[i]}<br />{d.slice(8)}</div>
                <div className="stack" style={{ gap: 6 }}>
                  {day.map((s) => (
                    <Link key={s.id} href={`/saude/treino/${s.id}`} className="row between">
                      <span><strong>{s.title}</strong><br /><span className="small muted">{SPORT_PT[s.sport] ?? s.sport} · {INTENSITY_PT[s.intensity] ?? s.intensity}{s.duration_min ? ` · ${s.duration_min} min` : ''}{s.distance_km ? ` · ${s.distance_km} km` : ''}{s.edited ? ' · ajustada' : ''}</span></span>
                      <StatusChip status={s.status} />
                    </Link>
                  ))}
                  {extra.map((a) => <span key={a.id} className="small muted">+ {a.title ?? SPORT_PT[a.sport]} · {Math.round(Number(a.duration_min))} min{a.distance_km ? ` · ${a.distance_km} km` : ''} ({a.source})</span>)}
                  {!day.length && !extra.length && <span className="small muted">descanso</span>}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <CoachPanel plan={plan ? { name: p?.name ?? 'Plano', rationale: plan.rationale, materialized_through: plan.materialized_through, progression_rule: p?.progression_rule, flags: p?.flags, refs: p?.refs, created_at: plan.created_at } : null} />
      <ReviewPanel review={review as ReviewRow | null} />
      <CheckinPanel checkin={checkin as CheckinRow | null} />
      <StravaPanel status={strava as { connected: boolean; athlete_name?: string; last_sync_at?: string | null } | null} />
    </div>
  )
}
