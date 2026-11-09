import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/database.types'
import { SUPABASE_KEY, SUPABASE_URL } from '@/lib/env'

export async function supabaseServer() {
  const store = await cookies()
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options))
        } catch {
          // chamado de um Server Component: o middleware já renovou a sessão
        }
      },
    },
  })
}

/** Usuário logado e membro da ClaudIA; senão null. */
export async function currentUser() {
  const sb = await supabaseServer()
  const { data } = await sb.auth.getUser()
  return data.user ? { sb, user: data.user } : null
}
