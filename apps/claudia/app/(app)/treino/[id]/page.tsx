import Link from 'next/link'
import { notFound } from 'next/navigation'
import { currentUser } from '@/lib/supabase/server'
import { fmtDay } from '@/lib/dates'
import { SPORT_PT, INTENSITY_PT, StatusChip } from '../ui'
import { SessionActions, SetLogger, SessionChat, DeleteSet } from './client'

export const dynamic = 'force-dynamic'
type Ex = { name: string; sets: number; reps: string; rpe_target?: number | null; rest_s?: number | null; load_kg?: number | null; notes?: string | null }

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const me = (await currentUser())!
  const { data: s } = await me.sb.from('plan_sessions').select('*').eq('id', Number(id)).maybeSingle()
  if (!s) notFound()
  const { data: planRow } = s.plan_id ? await me.sb.from('workout_plans').select('plan').eq('id', s.plan_id).maybeSingle() : { data: null }
  const target = (s.target ?? {}) as { exercises?: Ex[]; strength_day_index?: number | null; notes?: string | null; zone?: string | null; structure?: { label: string; minutes: number; target: string }[] }
  const plan = planRow?.plan as { days?: { label: string; exercises: Ex[] }[] } | null
  const exercises: Ex[] = target.exercises ?? (target.strength_day_index != null ? plan?.days?.[target.strength_day_index]?.exercises ?? [] : [])

  const [{ data: logs }, { data: prev }, { data: acts }] = await Promise.all([
    me.sb.from('workout_logs').select('id, exercise, set_number, reps, load_kg, rpe, note').eq('plan_session_id', s.id).order('performed_at'),
    exercises.length ? me.sb.from('workout_logs').select('exercise, local_date, reps, load_kg, rpe').in('exercise', exercises.map((e) => e.name)).neq('plan_session_id', s.id).order('performed_at', { ascending: false }).limit(80) : Promise.resolve({ data: [] as { exercise: string; local_date: string; reps: number | null; load_kg: number | null; rpe: number | null }[] }),
    me.sb.from('activities').select('title, duration_min, distance_km, avg_hr, source').eq('plan_session_id', s.id),
  ])
  const lastOf = new Map<string, string>()
  for (const l of prev ?? []) if (!lastOf.has(l.exercise)) lastOf.set(l.exercise, `${fmtDay(l.local_date)}: ${l.load_kg ?? '—'} kg × ${l.reps ?? '—'}${l.rpe ? ` @${l.rpe}` : ''}`)

  return (
    <div className="stack">
      <Link href={`/treino?w=${s.local_date}`} className="small muted">‹ Semana</Link>
      <div>
        <div className="row between"><h1>{s.title}</h1><StatusChip status={s.status} /></div>
        <p className="muted">{fmtDay(s.local_date)} · {SPORT_PT[s.sport] ?? s.sport} · {INTENSITY_PT[s.intensity] ?? s.intensity}{s.duration_min ? ` · ${s.duration_min} min` : ''}{s.distance_km ? ` · ${s.distance_km} km` : ''}{target.zone ? ` · ${target.zone}` : ''}</p>
        {target.notes && <p className="small">{target.notes}</p>}
      </div>

      <SessionActions id={s.id} status={s.status} date={s.local_date} />

      {!!target.structure?.length && (
        <section className="card"><h2>Estrutura</h2><div className="list small">{target.structure.map((b, i) => <div key={i} className="row between"><span>{b.label}</span><span className="muted">{b.minutes} min · {b.target}</span></div>)}</div></section>
      )}

      {!!exercises.length && (
        <section className="card">
          <h2>Exercícios</h2>
          <div className="list">
            {exercises.map((e) => (
              <div key={e.name}>
                <div className="row between"><strong>{e.name}</strong><span className="num">{e.sets}×{e.reps}{e.load_kg ? ` · ${e.load_kg} kg` : ''}</span></div>
                <div className="small muted">{e.rpe_target ? `RPE ${e.rpe_target}` : ''}{e.rest_s ? ` · descanso ${e.rest_s}s` : ''}{lastOf.get(e.name) ? ` · último ${lastOf.get(e.name)}` : ''}</div>
                {e.notes && <div className="small muted">{e.notes}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <SetLogger sessionId={s.id} exercises={exercises.map((e) => e.name)} counts={Object.fromEntries(exercises.map((e) => [e.name, (logs ?? []).filter((l) => l.exercise === e.name).length]))} />

      {!!logs?.length && (
        <section className="card"><h2>Séries registradas</h2><div className="list small">
          {logs.map((l) => <div key={l.id} className="row between"><span>{l.exercise} · série {l.set_number}</span><span className="row num" style={{ gap: 6 }}>{l.load_kg ?? '—'} kg × {l.reps ?? '—'}{l.rpe ? ` @${l.rpe}` : ''}<DeleteSet id={l.id} sessionId={s.id} /></span></div>)}
        </div></section>
      )}
      {!!acts?.length && <section className="card"><h2>Atividade registrada</h2>{acts.map((a, i) => <p key={i} className="small">{a.title} · {Math.round(Number(a.duration_min))} min{a.distance_km ? ` · ${a.distance_km} km` : ''}{a.avg_hr ? ` · FC ${a.avg_hr}` : ''} ({a.source})</p>)}</section>}

      <SessionChat sessionId={s.id} />
    </div>
  )
}
