import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Trilha, type ItemTrilha } from './Trilha'

export const dynamic = 'force-dynamic'

type Sabia = { trilha: { id: number; data: string; tipo: string; minutos: number; resumo: string | null; status: string; hoje: boolean } | null; itens: ItemTrilha[] } | null
const TIPO: Record<string, string> = { diaria: 'Trilha do dia', deep_dive: 'Deep dive do sábado', recap: 'Recap da semana', hobby: 'Hobby' }

export default async function Aprender() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_sabia')
  const s = (data ?? null) as Sabia
  const t = s?.trilha
  const feitos = (s?.itens ?? []).filter((i) => i.status !== 'pendente').length

  return (
    <div className="stack">
      <div>
        <h1>{t ? TIPO[t.tipo] ?? 'Trilha' : 'Sem trilha ainda'}</h1>
        <p className="muted small" style={{ margin: 0 }}>
          {t ? `${t.minutos} min · ${feitos}/${s?.itens.length ?? 0} vistos${t.hoje ? '' : ` · de ${t.data.slice(8, 10)}/${t.data.slice(5, 7)}`}` : 'A SabIA monta a trilha todo dia às 06:30.'}
        </p>
      </div>
      {error && <div className="card alert"><p className="small">Não consegui carregar a trilha agora.</p></div>}
      {t?.resumo && <section className="card ai"><span className="tag ai">Fio condutor</span><p style={{ margin: '6px 0 0' }}>{t.resumo}</p></section>}
      <Trilha itens={s?.itens ?? []} />
    </div>
  )
}
