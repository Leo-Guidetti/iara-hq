import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Trilha, type ItemTrilha } from './Trilha'
import { Md } from '@/lib/md'
import { GerarTrilha } from './GerarTrilha'

export const dynamic = 'force-dynamic'

type Sabia = { trilha: { id: number; data: string; tipo: string; minutos: number; resumo: string | null; status: string; hoje: boolean } | null; itens: ItemTrilha[] } | null
const TIPO: Record<string, string> = { diaria: 'Trilha do dia', deep_dive: 'Imersão do fim de semana', recap: 'Recap da semana', hobby: 'Hobby' }

export default async function Aprender() {
  const me = (await currentUser())!
  const raw = me.sb as unknown as SupabaseClient
  const { data, error } = await raw.rpc('hub_sabia')
  const s = (data ?? null) as Sabia
  const t = s?.trilha
  const feitos = (s?.itens ?? []).filter((i) => i.status !== 'pendente').length

  return (
    <>
      <section className="card" aria-label="Trilha atual">
        <span className="small" style={{ color: 'var(--accent)' }}>{t ? TIPO[t.tipo] ?? 'Trilha' : 'Sem trilha ainda'}{t && !t.hoje ? ` · de ${t.data.slice(8, 10)}/${t.data.slice(5, 7)}` : ''}</span>
        {t ? (
          <>
            <div className="barra" style={{ margin: '12px 0 8px' }} aria-hidden="true"><i style={{ width: `${s?.itens.length ? (feitos / s.itens.length) * 100 : 0}%` }} /></div>
            <div className="row between small muted"><span>{feitos} de {s?.itens.length ?? 0} itens</span><span>{t.minutos} min</span></div>
          </>
        ) : <p className="small muted" style={{ margin: '6px 0 0' }}>A SabIA monta a trilha todo dia às 06:30.</p>}
      </section>
      {error && <div className="card alert"><p className="small">Não consegui carregar a trilha agora.</p></div>}
      {!error && !t?.hoje && <GerarTrilha />}
      {t?.resumo && <details className="mais"><summary>{t.tipo === 'deep_dive' ? 'Síntese do tema' : 'Fio condutor da trilha'}</summary><div className="small" style={{ marginTop: 6 }}><Md texto={t.resumo} /></div></details>}
      <Trilha itens={s?.itens ?? []} />
    </>
  )
}
