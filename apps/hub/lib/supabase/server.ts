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

/** Usuário logado; senão null. getClaims confere a assinatura do JWT sem ir ao servidor de login
 *  quando o projeto usa chaves assimétricas (o middleware já validou a sessão); senão cai no getUser. */
export async function currentUser() {
  const sb = await supabaseServer()
  const { data } = await sb.auth.getClaims()
  const c = data?.claims
  return c ? { sb, user: { id: c.sub, email: c.email, user_metadata: c.user_metadata ?? {} } } : null
}
