import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Mercado, type Lista } from './Mercado'

export const dynamic = 'force-dynamic'

// Casa (IARA) › Mercado: lista única com preço estimado (public.hub_mercado; estimativa pelo iara-mercado, Haiku).
export default async function MercadoPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_mercado')
  const lista = (data ?? { itens: [], falta: 0, falta_min: 0, falta_max: 0, carrinho: 0, sem_preco: 0, sugestoes: [] }) as Lista
  return (
    <>
      {error && <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar agora.</p></div>}
      <Mercado lista={lista} />
    </>
  )
}
