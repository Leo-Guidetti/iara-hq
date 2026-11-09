// ClaudIA · utilidades de treino compartilhadas pelas funções claudia-coach*, -checkin e -strava.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.46.1'
import { addDays, weekStart } from './common.ts'
import { arr, num, obj, oneOf, optNum, optStr, str } from './validate.ts'

export const SPORTS = ['run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other'] as const
export const INTENSITIES = ['recovery', 'easy', 'moderate', 'tempo', 'threshold', 'intervals', 'long', 'strength'] as const
export const WEEKDAY_PT = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

export type Exercise = { name: string; sets: number; reps: string; rpe_target?: number | null; rest_s?: number | null; load_kg?: number | null; notes?: string | null }
export type StrengthDay = { label: string; focus?: string; exercises: Exercise[] }
export type WeekItem = {
  weekday: number; sport: string; title: string; intensity: string; duration_min: number
  distance_km?: number | null; zone?: string | null; notes?: string | null
  structure?: { label: string; minutes: number; target: string }[]; strength_day_index?: number | null
}
export type Plan = {
  version?: number; name: string; rationale?: string; days: StrengthDay[]; week: WeekItem[]
  progression_rule?: string; deload_rule?: string | null; weekly_targets?: unknown; daily_steps_target?: number | null
  flags?: string[]; prefs?: unknown; report?: string; refs?: string[]
}

/** Weekday 0 = segunda. */
export function weekdayOf(iso: string): number {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
}

export function validateExercise(v: unknown, p: string): Exercise {
  const o = obj(v, p)
  return {
    name: str(o.name, `${p}.name`, 120), sets: Math.round(num(o.sets, `${p}.sets`, 1, 10)), reps: str(String(o.reps ?? ''), `${p}.reps`, 20),
    rpe_target: optNum(o.rpe_target, `${p}.rpe_target`, 5, 10), rest_s: optNum(o.rest_s, `${p}.rest_s`, 15, 600),
    load_kg: optNum(o.load_kg, `${p}.load_kg`, 0, 500), notes: optStr(o.notes, `${p}.notes`, 400),
  }
}

export function validateWeekItem(v: unknown, p: string, nDays: number): WeekItem {
  const o = obj(v, p)
  const idx = o.strength_day_index == null ? null : Math.round(num(o.strength_day_index, `${p}.strength_day_index`, 0, Math.max(0, nDays - 1)))
  return {
    weekday: Math.round(num(o.weekday, `${p}.weekday`, 0, 6)),
    sport: oneOf(o.sport, `${p}.sport`, SPORTS), title: str(o.title, `${p}.title`, 120),
    intensity: oneOf(o.intensity, `${p}.intensity`, INTENSITIES),
    duration_min: Math.round(num(o.duration_min, `${p}.duration_min`, 5, 480)),
    distance_km: optNum(o.distance_km, `${p}.distance_km`, 0, 300), zone: optStr(o.zone, `${p}.zone`, 40), notes: optStr(o.notes, `${p}.notes`, 400),
    structure: o.structure == null ? [] : arr(o.structure, `${p}.structure`).slice(0, 8).map((s, i) => {
      const x = obj(s, `${p}.structure[${i}]`)
      return { label: str(x.label, 'label', 60), minutes: Math.round(num(x.minutes, 'minutes', 1, 300)), target: str(x.target, 'target', 160) }
    }),
    strength_day_index: o.sport === 'strength' ? idx ?? 0 : idx,
  }
}

export function validatePlan(v: unknown): Plan {
  const o = obj(v)
  const days = arr(o.days ?? [], 'days').slice(0, 6).map((d, i) => {
    const x = obj(d, `days[${i}]`)
    return { label: str(x.label, `days[${i}].label`, 80), focus: optStr(x.focus, `days[${i}].focus`, 120) ?? undefined,
      exercises: arr(x.exercises, `days[${i}].exercises`).slice(0, 10).map((e, j) => validateExercise(e, `days[${i}].exercises[${j}]`)) }
  })
  const week = arr(o.week, 'week').slice(0, 14).map((w, i) => validateWeekItem(w, `week[${i}]`, days.length))
  if (!week.length) throw new Error('week vazia')
  return {
    version: 5, name: str(o.name, 'name', 160), rationale: optStr(o.rationale, 'rationale', 3000) ?? undefined, days, week,
    progression_rule: optStr(o.progression_rule, 'progression_rule', 1500) ?? undefined, deload_rule: optStr(o.deload_rule, 'deload_rule', 800),
    daily_steps_target: optNum(o.daily_steps_target, 'daily_steps_target', 0, 30000),
    flags: (o.flags == null ? [] : arr(o.flags, 'flags')).slice(0, 8).map((f, i) => str(f, `flags[${i}]`, 400)),
    refs: (o.refs == null ? [] : arr(o.refs, 'refs')).slice(0, 8).map((f, i) => str(f, `refs[${i}]`, 300)),
  }
}

/** Linha de plan_sessions a partir de um item da semana-modelo. */
export function sessionFromItem(userId: string, planId: number, date: string, w: WeekItem) {
  return {
    user_id: userId, plan_id: planId, local_date: date, sport: w.sport, title: w.title, intensity: w.intensity,
    duration_min: w.duration_min, distance_km: w.distance_km ?? null, status: 'planned', origin: 'ai', edited: false,
    target: { zone: w.zone ?? null, notes: w.notes ?? null, structure: w.structure ?? [], strength_day_index: w.strength_day_index ?? null },
  }
}

/** Materializa a semana-modelo de `from` até `to` (inclusive). Não toca em sessões existentes. */
export async function materialize(db: SupabaseClient, userId: string, planId: number, plan: Plan, from: string, to: string) {
  const rows = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const w of plan.week.filter((x) => x.weekday === weekdayOf(d))) rows.push(sessionFromItem(userId, planId, d, w))
  }
  if (rows.length) {
    const { error } = await db.from('plan_sessions').insert(rows)
    if (error) throw new Error(error.message)
  }
  const { error } = await db.from('workout_plans').update({ materialized_through: to }).eq('id', planId)
  if (error) throw new Error(error.message)
  return rows.length
}

/** Exercícios de uma sessão: os do patch na sessão ou os do dia de força do plano. */
export function exercisesOf(target: Record<string, unknown> | null, plan: Plan | null): Exercise[] {
  if (Array.isArray(target?.exercises)) return target!.exercises as Exercise[]
  const idx = target?.strength_day_index
  return typeof idx === 'number' && plan?.days?.[idx] ? plan.days[idx].exercises : []
}

/** Resumo compacto do histórico de treino (não é dump de tabela). */
export async function trainingSummary(db: SupabaseClient, today: string, days = 28) {
  const from = addDays(today, -days)
  const [{ data: sessions }, { data: logs }, { data: acts }] = await Promise.all([
    db.from('plan_sessions').select('id, local_date, sport, title, status, intensity, duration_min').gte('local_date', from).lte('local_date', today).order('local_date'),
    db.from('workout_logs').select('local_date, exercise, set_number, reps, load_kg, rpe').gte('local_date', from).order('performed_at'),
    db.from('activities').select('local_date, sport, title, duration_min, distance_km, avg_hr, rpe, load, source').gte('local_date', from).order('local_date'),
  ])
  const past = (sessions ?? []).filter((s) => s.local_date < today)
  const done = past.filter((s) => s.status === 'done').length
  const adherence = past.length ? Math.round((done / past.length) * 100) : null

  // por exercício: última sessão (melhor série) e tendência de carga
  const byEx = new Map<string, { date: string; load: number; reps: number; rpe: number | null }[]>()
  for (const l of logs ?? []) {
    const list = byEx.get(l.exercise) ?? []
    const prev = list.find((x) => x.date === l.local_date)
    const load = Number(l.load_kg ?? 0)
    if (!prev) list.push({ date: l.local_date, load, reps: l.reps ?? 0, rpe: l.rpe == null ? null : Number(l.rpe) })
    else if (load > prev.load || (load === prev.load && (l.rpe ?? 0) > (prev.rpe ?? 0))) Object.assign(prev, { load, reps: l.reps ?? 0, rpe: l.rpe == null ? null : Number(l.rpe) })
    byEx.set(l.exercise, list)
  }
  const strength = [...byEx.entries()].map(([ex, xs]) => {
    const last = xs.at(-1)!, first = xs[0]
    return `${ex}: ${xs.length}x; última ${last.date} ${last.load} kg × ${last.reps}${last.rpe ? ` @RPE ${last.rpe}` : ''}${xs.length > 1 ? `; carga ${first.load}→${last.load} kg` : ''}`
  })
  const cardio = (acts ?? []).map((a) => `${a.local_date} ${a.sport} ${Math.round(Number(a.duration_min))} min${a.distance_km ? ` ${a.distance_km} km` : ''}${a.avg_hr ? ` FC ${a.avg_hr}` : ''}${a.rpe ? ` PSE ${a.rpe}` : ''} (${a.source})`)
  const missed = past.filter((s) => s.status !== 'done').map((s) => `${s.local_date} ${s.title} (${s.status})`)
  return {
    adherence, planned: past.length, done,
    text: [
      `Aderência ${days} dias: ${adherence ?? '—'}% (${done}/${past.length} sessões).`,
      `Força por exercício: ${strength.length ? strength.join(' | ') : 'sem registros'}.`,
      `Atividades (Strava/manual): ${cardio.length ? cardio.join(' | ') : 'nenhuma'}.`,
      `Não feitas: ${missed.slice(-10).join(' | ') || 'nenhuma'}.`,
    ].join('\n'),
    sessions: sessions ?? [], logs: logs ?? [],
  }
}

export async function activePlan(db: SupabaseClient) {
  const { data } = await db.from('workout_plans').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data as (null | { id: number; plan: Plan; valid_from: string; valid_to: string | null; materialized_through: string | null; goal: string | null })
}

export function profileText(tp: Record<string, unknown> | null) {
  if (!tp) return 'Perfil de treino não preenchido.'
  return `Perfil de treino: objetivo ${tp.goal ?? '—'}; esportes ${JSON.stringify(tp.sports)}; dias disponíveis ${(tp.weekdays as number[] | null)?.map((d) => WEEKDAY_PT[d]).join(', ') ?? '—'}; ` +
    `${tp.session_minutes} min/sessão; equipamento ${tp.equipment}; limitações: ${tp.limitations ?? 'nenhuma'}; ` +
    `FC máx ${tp.hr_max ?? '—'}, repouso ${tp.hr_rest ?? '—'}, FTP ${tp.ftp_w ?? '—'} W, limiar corrida ${tp.run_threshold_s_km ?? '—'} s/km, CSS ${tp.swim_css_s_100 ?? '—'} s/100m; ` +
    `evento ${tp.event ? JSON.stringify(tp.event) : 'nenhum'}; notas: ${tp.coach_notes ?? '—'}.`
}

export { weekStart }
