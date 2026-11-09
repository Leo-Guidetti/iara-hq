'use server'
import { revalidatePath } from 'next/cache'
import { currentUser } from '@/lib/supabase/server'

export type FormState = { error?: string; ok?: boolean }

const FIELDS = [
  ['waist_cm', 40, 200], ['neck_cm', 20, 70], ['hip_cm', 50, 200],
  ['chest_cm', 50, 200], ['arm_cm', 15, 70], ['thigh_cm', 25, 100],
] as const

export async function addMeasurement(_: FormState, form: FormData): Promise<FormState> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const row: Record<string, number | null> = {}
  for (const [k, min, max] of FIELDS) {
    const raw = String(form.get(k) ?? '').replace(',', '.').trim()
    if (!raw) { row[k] = null; continue }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < min || n > max) return { error: `${k.replace('_cm', '')}: entre ${min} e ${max} cm.` }
    row[k] = Math.round(n * 10) / 10
  }
  if (row.waist_cm == null) return { error: 'A cintura é obrigatória: é ela que alimenta as estimativas.' }
  const when = String(form.get('measured_at') ?? '')
  const measured = when ? new Date(`${when}T08:00:00-03:00`) : new Date()
  const { error } = await me.sb.from('measurements').insert({
    user_id: me.user.id, ...row,
    measured_at: measured.toISOString(),
    local_date: measured.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
    note: String(form.get('note') ?? '').trim().slice(0, 500) || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/corpo')
  return { ok: true }
}

export async function savePhoto(input: { pose: string; storage_path: string; taken_at: string; protocol: Record<string, unknown>; note?: string }) {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  if (!['front', 'side', 'back'].includes(input.pose)) return { error: 'Pose inválida.' }
  if (!input.storage_path.startsWith(`${me.user.id}/`)) return { error: 'Caminho inválido.' }
  const taken = new Date(input.taken_at)
  const { error } = await me.sb.from('progress_photos').insert({
    user_id: me.user.id, pose: input.pose, storage_path: input.storage_path, taken_at: taken.toISOString(),
    local_date: taken.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
    protocol: input.protocol as never, note: input.note?.slice(0, 500) || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/corpo')
  return { ok: true }
}
