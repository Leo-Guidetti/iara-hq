'use server'
import { revalidatePath } from 'next/cache'
import { currentUser } from '@/lib/supabase/server'

export type FormState = { error?: string; ok?: boolean }

export async function addWeight(_: FormState, form: FormData): Promise<FormState> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const kg = Number(String(form.get('weight_kg') ?? '').replace(',', '.'))
  if (!Number.isFinite(kg) || kg < 30 || kg > 300) return { error: 'Peso entre 30 e 300 kg.' }
  const when = String(form.get('measured_at') ?? '')
  // datetime-local vem sem fuso; o Brasil não tem horário de verão desde 2019, então São Paulo = -03:00
  const measured = when ? new Date(`${when}:00-03:00`) : new Date()
  if (Number.isNaN(measured.getTime())) return { error: 'Data inválida.' }
  const note = String(form.get('note') ?? '').trim().slice(0, 500) || null

  const { error } = await me.sb.from('weight_entries').insert({
    user_id: me.user.id,
    weight_kg: Math.round(kg * 10) / 10,
    measured_at: measured.toISOString(),
    local_date: measured.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), // o trigger recalcula
    fasted: form.get('fasted') === 'on',
    source: 'manual',
    note,
  })
  if (error) return { error: error.message }
  revalidatePath('/saude/peso')
  revalidatePath('/saude')
  return { ok: true }
}

export async function deleteWeight(id: number) {
  const me = await currentUser()
  if (!me) return
  await me.sb.from('weight_entries').delete().eq('id', id).eq('user_id', me.user.id)
  revalidatePath('/saude/peso')
  revalidatePath('/saude')
}
