import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Fila, type Item } from './Fila'

export const dynamic = 'force-dynamic'

// IARA House: só o que é da casa (tarefas, lembretes, compras). O briefing geral do dia fica na Hoje.
type Casa = { itens: Item[] } | null

export default async function CasaPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_casa')
  const itens = ((data ?? null) as Casa)?.itens.filter((i) => i.origem === 'iara') ?? []

  return (
    <div className="stack">
      <div>
        <h1>Sua casa</h1>
        <p className="muted small" style={{ margin: 0 }}>Tarefas, lembretes e compras da casa.</p>
      </div>
      {error && <div className="card alert"><p className="small">Não consegui carregar agora.</p></div>}
      <Fila itens={itens} vazio="Nenhuma tarefa da casa para hoje." />
      <section className="card">
        <span className="tag">Em migração</span>
        <p className="small" style={{ margin: '6px 0 0' }}>
          As listas de compras, tarefas e a rotina da casa ainda estão no Supabase antigo da IARA. Assim que ele for
          reativado, elas vêm para cá e esta tela passa a mostrar tudo da casa.
        </p>
      </section>
    </div>
  )
}
