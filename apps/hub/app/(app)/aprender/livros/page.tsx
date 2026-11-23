import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { LivrosBloco, type Livros } from '../Livros'

export const dynamic = 'force-dynamic'

export default async function LivrosPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_livros')
  return <LivrosBloco dados={(data ?? null) as Livros | null} erro={!!error || !data} />
}
