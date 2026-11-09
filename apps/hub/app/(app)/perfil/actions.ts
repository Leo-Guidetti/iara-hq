'use server'
import { revalidatePath } from 'next/cache'
import { currentUser } from '@/lib/supabase/server'

export type PState = { error?: string; ok?: boolean }
export async function saveProfile(_: PState, form: FormData): Promise<PState> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const h = String(form.get('height_cm') ?? '').replace(',', '.').trim()
  const height = h ? Number(h) : null
  if (height != null && !(height >= 120 && height <= 230)) return { error: 'Altura entre 120 e 230 cm.' }
  const sex = String(form.get('sex') ?? '') || null
  const birth = String(form.get('birth_date') ?? '') || null
  const { error } = await me.sb.from('profiles').update({
    display_name: String(form.get('display_name') ?? '').trim().slice(0, 60) || null,
    sex: sex === 'male' || sex === 'female' ? sex : null, birth_date: birth, height_cm: height,
    goal: String(form.get('goal') ?? '').trim().slice(0, 300) || null,
  }).eq('id', me.user.id)
  if (error) return { error: error.message }
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function createToken(label: string): Promise<{ token?: string; error?: string }> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const { data, error } = await me.sb.rpc('create_ingest_token', { p_label: label.slice(0, 40) || 'iPhone' })
  if (error) return { error: error.message }
  revalidatePath('/perfil')
  return { token: data }
}

export async function revokeToken(id: number) {
  const me = await currentUser()
  if (!me) return
  await me.sb.from('ingest_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', id)
  revalidatePath('/perfil')
}
