import type { SupabaseClient } from '@supabase/supabase-js'
import { currentUser } from '@/lib/supabase/server'
import { Fila, type Item } from './Fila'

export const dynamic = 'force-dynamic'

// IARA House dentro do site único: briefings da IARA e a fila de itens de todos os agentes (core.itens).
const IARA_COMPLETA = 'https://iara-rho.vercel.app'

type Casa = { briefings: { id: number; tipo: string; data: string; texto: string | null; lido: boolean }[]; itens: Item[] } | null

export default async function CasaPage() {
  const me = (await currentUser())!
  const { data, error } = await (me.sb as unknown as SupabaseClient).rpc('hub_casa')
  const c = (data ?? null) as Casa

  return (
    <div className="stack">
      <div>
        <span className="tag progress">IARA House · Casa e rotina</span>
        <h1>Sua fila</h1>
        <p className="muted small" style={{ margin: 0 }}>O que os agentes deixaram para você, e o que a IARA tem a dizer.</p>
      </div>

      {error && <div className="card alert"><p className="small">Não consegui carregar a fila agora.</p></div>}

      <Fila itens={c?.itens ?? []} />

      {(c?.briefings ?? []).map((b) => (
        <section key={b.id} className="card ai">
          <span className="tag ai">Briefing {b.tipo === 'noite' ? 'da noite' : 'da manhã'} · {b.data.slice(8, 10)}/{b.data.slice(5, 7)}</span>
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{b.texto ?? 'Sem texto.'}</p>
        </section>
      ))}

      <a className="btn ghost" href={IARA_COMPLETA} target="_blank" rel="noreferrer" style={{ textAlign: 'center' }}>Casa, compras e rotina no app completo da IARA ↗</a>
    </div>
  )
}
