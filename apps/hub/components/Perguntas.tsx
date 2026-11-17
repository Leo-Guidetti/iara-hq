'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { minutosAte, useAgora } from '@/lib/useAgora'

export type Aviso = { id: number; titulo: string; corpo: string | null; pergunta: string | null; opcoes: string[] | null; link: string | null; status: string }
type Acao = { acao_id?: number; requer_sim?: boolean; pergunta?: string; expira_em?: string; desfazer?: { acao_id: number; ate: string } | null } | null
type Resultado = { fala: string; erro?: boolean; acao?: Acao; link?: string | null; confirmada?: boolean; desfeita?: boolean }

const sb = () => supabaseBrowser() as unknown as SupabaseClient

function Cartao({ a, destaque }: { a: Aviso; destaque?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<Resultado | null>(null)
  const desfazerAte = r?.acao?.desfazer?.ate
  const agora = useAgora(!!desfazerAte)
  const opcoes = a.opcoes?.length ? a.opcoes : ['Sim', 'Depois']

  async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
    setBusy(true)
    const { data, error } = await sb().rpc(fn, args)
    setBusy(false)
    return error ? null : (data as T)
  }
  const falhou = () => setR((x) => ({ ...(x ?? { fala: '' }), fala: 'Não consegui agora. Tente de novo.', erro: true }))

  async function responder(o: string) {
    const d = await chamar<{ ok?: boolean; fala?: string; acao?: Acao; link?: string | null }>('hub_aviso_responder', { p_id: a.id, p_resposta: o })
    if (!d) return falhou()
    setR({ fala: d.fala || (d.ok ? 'Pronto.' : 'Esse aviso não vale mais.'), erro: d.ok === false, acao: d.acao ?? null, link: d.link })
    if (d.ok) router.refresh()
  }
  async function decidir(sim: boolean) {
    const id = r?.acao?.acao_id
    if (!id) return
    const d = await chamar<{ status?: string; ok?: boolean; fala?: string; desfazer?: { acao_id: number; ate: string } | null }>(sim ? 'hub_acao_confirmar' : 'hub_acao_cancelar', { p_id: id })
    if (!d) return falhou()
    if (!sim) { setR({ fala: 'Certo, cancelado.', link: r?.link }); return }
    const feito = d.status === 'executada'
    setR({ fala: d.fala || (feito ? 'Feito.' : 'Essa confirmação não vale mais.'), erro: !feito, link: r?.link, acao: feito ? { desfazer: d.desfazer ?? null } : null })
    if (feito) router.refresh()
  }
  async function desfazer() {
    const id = r?.acao?.desfazer?.acao_id
    if (!id) return
    const d = await chamar<{ ok?: boolean; fala?: string }>('hub_acao_desfazer', { p_id: id })
    if (!d) return falhou()
    setR({ fala: d.fala || (d.ok ? 'Desfeito.' : 'Não deu para desfazer.'), erro: d.ok === false, link: r?.link })
    if (d.ok) router.refresh()
  }

  const confirmar = !!r?.acao?.requer_sim && !!r.acao.acao_id
  const podeDesfazer = !!desfazerAte && Date.parse(desfazerAte) > agora

  return (
    <section className={`card ai stack${destaque ? ' brief-card' : ''}`} style={{ gap: 8 }} aria-label="Pergunta da IARA">
      <span className="tag ai">Pergunta da IARA</span>
      <h2 style={{ margin: 0, fontSize: '1rem' }}>{a.titulo}</h2>
      {a.corpo && <p className="small" style={{ margin: 0 }}>{a.corpo}</p>}
      {a.pergunta && <p style={{ margin: 0, fontWeight: 600 }}>{a.pergunta}</p>}
      {!r && a.status !== 'respondido' && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {opcoes.map((o, i) => <button key={o} className={i === 0 ? 'btn ai' : 'btn ghost'} disabled={busy} onClick={() => responder(o)}>{o}</button>)}
        </div>
      )}
      {!r && a.status === 'respondido' && <p className="small muted" style={{ margin: 0 }}>Você já respondeu.</p>}
      {r && <p className={r.erro ? 'error small' : 'small'} style={{ margin: 0 }} aria-live="polite">{r.fala}</p>}
      {confirmar && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn ai" disabled={busy} onClick={() => decidir(true)}>Sim</button>
          <button className="btn ghost" disabled={busy} onClick={() => decidir(false)}>Não</button>
          {r?.acao?.expira_em && <span className="small muted">vale por {minutosAte(r.acao.expira_em, agora)} min</span>}
        </div>
      )}
      {!confirmar && podeDesfazer && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn ghost" disabled={busy} onClick={desfazer}>Desfazer</button>
          <span className="small muted">vale por {minutosAte(desfazerAte!, agora)} min</span>
        </div>
      )}
      {r && r.link && !confirmar && <Link className="small" href={r.link} style={{ color: 'var(--accent)' }}>Abrir →</Link>}
    </section>
  )
}

/** Perguntas da IARA: com ?pergunta=<id> mostra aquele aviso no topo; sem, uma linha discreta com as não respondidas de hoje. */
export function Perguntas({ avisos, foco, falhou }: { avisos: Aviso[]; foco: number | null; falhou: boolean }) {
  const [aberto, setAberto] = useState(false)
  if (foco != null) {
    const a = avisos.find((x) => x.id === foco)
    if (falhou) return <p className="small error">Não consegui carregar a pergunta agora.</p>
    if (!a) return <section className="card"><p className="small muted" style={{ margin: 0 }}>Essa pergunta não vale mais.</p></section>
    return <Cartao a={a} destaque />
  }
  const abertas = avisos.filter((x) => x.status === 'enviado')
  if (!abertas.length) return null
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button className="btn ghost" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        {abertas.length} {abertas.length === 1 ? 'pergunta' : 'perguntas'} da IARA {aberto ? '▴' : '▾'}
      </button>
      {aberto && abertas.map((a) => <Cartao key={a.id} a={a} />)}
    </div>
  )
}
