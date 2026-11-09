'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type ItemTrilha = { id: number; ordem: number; tema: string | null; titulo: string; fonte: string | null; url: string | null; formato: string; minutos: number; por_que: string | null; takeaway: string | null; corpo: string | null; status: string; reacao: number | null }

const FORMATO: Record<string, string> = { artigo: 'Artigo', newsletter: 'Newsletter', podcast: 'Podcast', video: 'Vídeo', paper: 'Paper', recap: 'Recap', livro: 'Livro' }

/** Itens da trilha com ações: lido / pular / reação (alimenta os pesos da SabIA). */
export function Trilha({ itens }: { itens: ItemTrilha[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function marcar(id: number, status: 'feito' | 'pulado' | 'pendente', reacao?: number) {
    setBusy(id); setErro(null)
    const { error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_sabia_item', { p_id: id, p_status: status, p_reacao: reacao ?? null })
    setBusy(null)
    if (error) setErro('Não deu para salvar. Tente de novo.')
    else router.refresh()
  }

  if (!itens.length) return null
  return (
    <div className="stack" style={{ gap: 12 }}>
      {erro && <p className="error">{erro}</p>}
      {itens.map((i) => (
        <section key={i.id} className={`card module${i.status !== 'pendente' ? ' feito' : ''}`} style={i.status !== 'pendente' ? { opacity: 0.6 } : undefined}>
          <div className="row between">
            <span className="tag">{i.tema ?? 'SabIA'}</span>
            <span className="small muted">{FORMATO[i.formato] ?? i.formato} · {i.minutos} min{i.status === 'feito' ? ' · ✓ lido' : i.status === 'pulado' ? ' · pulado' : ''}</span>
          </div>
          <strong>{i.titulo}</strong>
          {i.fonte && <span className="small muted">{i.fonte}</span>}
          {i.por_que && <p className="small" style={{ margin: 0 }}>{i.por_que}</p>}
          {i.takeaway && <p className="small muted" style={{ margin: 0 }}>💡 {i.takeaway}</p>}
          {i.corpo && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{i.corpo}</p>}
          <div className="chips">
            {i.url && <a className="chip on" href={i.url} target="_blank" rel="noreferrer">Abrir ↗</a>}
            {i.status === 'pendente' ? (
              <>
                <button className="chip" disabled={busy === i.id} onClick={() => marcar(i.id, 'feito')}>✓ Lido</button>
                <button className="chip" disabled={busy === i.id} onClick={() => marcar(i.id, 'pulado')}>Pular</button>
              </>
            ) : <button className="chip" disabled={busy === i.id} onClick={() => marcar(i.id, 'pendente')}>Desfazer</button>}
            <button className={`chip${i.reacao === 1 ? ' on' : ''}`} disabled={busy === i.id} aria-label="Gostei" onClick={() => marcar(i.id, i.status === 'pendente' ? 'feito' : (i.status as 'feito' | 'pulado'), 1)}>👍</button>
            <button className={`chip${i.reacao === -1 ? ' on' : ''}`} disabled={busy === i.id} aria-label="Não gostei" onClick={() => marcar(i.id, i.status === 'pendente' ? 'feito' : (i.status as 'feito' | 'pulado'), -1)}>👎</button>
          </div>
        </section>
      ))}
    </div>
  )
}
