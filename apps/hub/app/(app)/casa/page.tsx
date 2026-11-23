import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { spDate } from '@/lib/dates'
import { Tarefas, type Recorrencia } from './Tarefas'
import { proximas, type Tarefa } from './proximas'

export const dynamic = 'force-dynamic'

// Casa (IARA) › Tarefas: semana com checklist, recorrentes (mostra só a próxima de cada) e lembretes com hora.
// RPCs: public.hub_casa_tarefas / hub_casa_recorrencias / hub_tarefa_salvar / hub_tarefa_lembrete / hub_recorrencia_parar.
export default async function CasaPage() {
  const me = (await currentUser())!
  const sb = me.sb as unknown as SupabaseClient
  const [{ data, error }, { data: rd }] = await Promise.all([sb.rpc('hub_casa_tarefas'), sb.rpc('hub_casa_recorrencias')])
  const hoje = spDate()
  const itens = proximas((Array.isArray(data) ? data : []) as Tarefa[], hoje)
  const recs = (Array.isArray(rd) ? rd : []) as Recorrencia[]
  const abertas = itens.filter((i) => i.status !== 'feito').length

  return (
    <>
      <div className="hello">
        <span className="small muted">Esta semana</span>
        <h1>{abertas ? `${abertas} ${abertas === 1 ? 'tarefa aberta' : 'tarefas abertas'}` : 'Tudo em dia'}</h1>
      </div>
      {error && <div className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar agora.</p></div>}
      <Tarefas itens={itens} recs={recs} hoje={hoje} />
    </>
  )
}
