import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { PraticaBloco, type Praticas } from '../Pratica'

export const dynamic = 'force-dynamic'

export default async function PraticaPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_praticas')
  return <PraticaBloco dados={(data ?? null) as Praticas | null} erro={!!error || !data} />
}
