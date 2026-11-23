import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'
import { Tarefas, type Tarefa } from './Tarefas'

export const dynamic = 'force-dynamic'

// Casa (IARA): só o que é da casa. Tarefas da semana com checklist e "Nova tarefa" (public.hub_casa_tarefas / hub_tarefa_criar).
export default async function CasaPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_casa_tarefas')
  const itens = (Array.isArray(data) ? data : []) as Tarefa[]
  const abertas = itens.filter((i) => i.status !== 'feito').length

  return (
    <div className="stack">
      <div className="hello">
        <span className="small muted">Esta semana</span>
        <h1>{abertas ? `${abertas} ${abertas === 1 ? 'tarefa aberta' : 'tarefas abertas'}` : 'Tudo em dia'}</h1>
      </div>
      {error && <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar agora.</p></div>}
      <Tarefas itens={itens} hoje={spDate()} />
      <p className="small" style={{ color: 'var(--dim)', margin: 0 }}>Rotinas, compras e listas da casa chegam quando o Supabase antigo da IARA for reativado.</p>
    </div>
  )
}
