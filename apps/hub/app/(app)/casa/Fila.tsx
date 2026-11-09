'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type Item = { id: number; origem: string; tipo: string; titulo: string; detalhe: string | null; data: string; minutos: number | null; acao: { url?: string; rotulo?: string; externo?: string }; status: string; prioridade: string }

const ORIGEM: Record<string, { nome: string; app: string }> = {
  sabia: { nome: 'SabIA', app: 'hq' }, iara: { nome: 'IARA', app: 'casa' }, airton: { nome: 'AIrton', app: 'airton' },
  claudia: { nome: 'ClaudIA', app: 'claudia' }, gmail: { nome: 'Gmail', app: 'hq' }, agenda: { nome: 'Agenda', app: 'hq' },
}

// Rotas que já existem no hub (o /aprender da SabIA ainda não veio para cá).
const ROTAS = ['/hoje', '/saude', '/financas', '/casa', '/perfil']

/** Fila do dia (core.itens) com as ações feito / amanhã / ignorar, via public.hub_item_status. */
export function Fila({ itens }: { itens: Item[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function mudar(id: number, status: 'feito' | 'adiado' | 'ignorado') {
    setBusy(id); setErro(null)
    const { error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_item_status', { p_id: id, p_status: status })
    setBusy(null)
    if (error) setErro('Não deu para salvar. Tente de novo.')
    else router.refresh()
  }

  if (!itens.length) return <section className="card"><p className="small muted" style={{ margin: 0 }}>Fila vazia: nada pendente hoje.</p></section>
  return (
    <div className="stack" style={{ gap: 12 }}>
      {erro && <p className="error">{erro}</p>}
      {itens.map((i) => {
        const o = ORIGEM[i.origem] ?? { nome: i.origem, app: 'hq' }
        return (
          <section key={i.id} className="card module" data-app={o.app}>
            <div className="row between">
              <span className="tag">{o.nome}</span>
              <span className="small muted">{i.minutos ? `${i.minutos} min` : ''}{i.status === 'adiado' ? ' · adiado' : ''}</span>
            </div>
            <strong>{i.titulo}</strong>
            {i.detalhe && <p className="small muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{i.detalhe}</p>}
            <div className="chips">
              {i.acao?.url && ROTAS.some((r) => i.acao.url!.startsWith(r)) && <a className="chip on" href={i.acao.url}>{i.acao.rotulo ?? 'Abrir'}</a>}
              <button className="chip" disabled={busy === i.id} onClick={() => mudar(i.id, 'feito')}>✓ Feito</button>
              <button className="chip" disabled={busy === i.id} onClick={() => mudar(i.id, 'adiado')}>Amanhã</button>
              <button className="chip" disabled={busy === i.id} onClick={() => mudar(i.id, 'ignorado')}>Ignorar</button>
            </div>
          </section>
        )
      })}
    </div>
  )
}
