'use client'
import { supabaseBrowser } from '@/lib/supabase/client'
import { FUNCTIONS_URL, SUPABASE_KEY } from '@/lib/env'

/** Chama uma Edge Function claudia-* com o JWT da sessão. Lança Error com a mensagem da função. */
export async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sessão expirada: entre de novo.')
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Erro ${res.status}`)
  return json as T
}
