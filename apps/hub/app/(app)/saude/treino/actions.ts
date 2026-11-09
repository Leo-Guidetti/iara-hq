'use server'
import { revalidatePath } from 'next/cache'
import { currentUser } from '@/lib/supabase/server'
import { fmtDay } from '@/lib/dates'

const rv = (id?: number) => { revalidatePath('/saude/treino'); if (id) revalidatePath(`/saude/treino/${id}`); revalidatePath('/saude') }

export async function setStatus(id: number, status: 'planned' | 'done' | 'skipped') {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const { error } = await me.sb.from('plan_sessions').update({ status }).eq('id', id)
  if (error) return { error: error.message }
  rv(id)
  return { ok: true }
}

export async function moveSession(id: number, date: string) {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Data inválida.' }
  const { data: s } = await me.sb.from('plan_sessions').select('id, plan_id, local_date').eq('id', id).single()
  if (!s || s.local_date === date) return { ok: true }
  const { error } = await me.sb.from('plan_sessions').update({ local_date: date, edited: true }).eq('id', id)
  if (error) return { error: error.message }
  await me.sb.from('plan_changes').insert({ user_id: me.user.id, plan_id: s.plan_id, session_id: id, local_date: s.local_date, scope: 'session', source: 'user', summary: `movida de ${fmtDay(s.local_date)} para ${fmtDay(date)}`, before: { local_date: s.local_date }, after: { local_date: date } })
  rv(id)
  return { ok: true }
}

export type SetState = { error?: string; ok?: boolean }
export async function logSet(_: SetState, form: FormData): Promise<SetState> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const sessionId = Number(form.get('session_id'))
  const exercise = String(form.get('exercise') ?? '').trim().slice(0, 120)
  if (!exercise) return { error: 'Escolha o exercício.' }
  const n = (k: string) => { const v = String(form.get(k) ?? '').replace(',', '.').trim(); return v === '' ? null : Number(v) }
  const reps = n('reps'), load = n('load_kg'), rpe = n('rpe'), setNumber = n('set_number') ?? 1
  if (reps != null && (reps < 0 || reps > 100)) return { error: 'Reps entre 0 e 100.' }
  if (rpe != null && (rpe < 1 || rpe > 10)) return { error: 'RPE entre 1 e 10.' }
  if (load != null && load < 0) return { error: 'Carga inválida.' }
  const { data: s } = await me.sb.from('plan_sessions').select('plan_id, local_date').eq('id', sessionId).single()
  const now = new Date()
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const { error } = await me.sb.from('workout_logs').insert({
    user_id: me.user.id, plan_session_id: sessionId, plan_id: s?.plan_id ?? null, exercise,
    set_number: Math.min(20, Math.max(1, Math.round(setNumber))), reps: reps == null ? null : Math.round(reps), load_kg: load, rpe,
    performed_at: now.toISOString(), local_date: today, note: String(form.get('note') ?? '').trim().slice(0, 300) || null,
  })
  if (error) return { error: error.message }
  rv(sessionId)
  return { ok: true }
}

export async function deleteSet(id: number, sessionId: number) {
  const me = await currentUser()
  if (!me) return
  await me.sb.from('workout_logs').delete().eq('id', id).eq('user_id', me.user.id)
  rv(sessionId)
}

export type ProfState = { error?: string; ok?: boolean }
export async function saveTrainingProfile(_: ProfState, form: FormData): Promise<ProfState> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const n = (k: string) => { const v = String(form.get(k) ?? '').trim(); return v === '' ? null : Number(v) }
  const sports = ['strength', 'run', 'walk', 'swim', 'ride_indoor', 'ride_outdoor', 'hiit', 'yoga', 'mobility', 'row']
    .filter((s) => form.get(`sport_${s}`)).map((s) => ({ sport: s, level: String(form.get(`level_${s}`) ?? 'beginner') }))
  const weekdays = [0, 1, 2, 3, 4, 5, 6].filter((d) => form.get(`wd_${d}`))
  const row = {
    user_id: me.user.id, goal: String(form.get('goal') ?? '').trim() || null, sports, weekdays,
    session_minutes: n('session_minutes') ?? 45, equipment: String(form.get('equipment') ?? 'gym'),
    limitations: String(form.get('limitations') ?? '').trim() || null, coach_notes: String(form.get('coach_notes') ?? '').trim().slice(0, 4000) || null,
    hr_max: n('hr_max'), hr_rest: n('hr_rest'), ftp_w: n('ftp_w'), run_threshold_s_km: n('run_threshold_s_km'), swim_css_s_100: n('swim_css_s_100'),
    updated_at: new Date().toISOString(),
  }
  const { error } = await me.sb.from('training_profiles').upsert(row as never, { onConflict: 'user_id' })
  if (error) return { error: error.message.includes('check') ? `Valor fora do permitido: ${error.message}` : error.message }
  revalidatePath('/saude/treino'); revalidatePath('/saude/treino/perfil')
  return { ok: true }
}
