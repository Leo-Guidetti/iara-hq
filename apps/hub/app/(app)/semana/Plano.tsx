'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'

export type ItemSemana = {
  id: number; data: string; hora: string | null; area: 'saude' | 'financas' | 'aprender' | 'casa'
  titulo: string; detalhe: string | null; minutos: number | null; valor: number | null; incluido: boolean; status: string | null
}
export type PlanoSemana = { id: number; semana: string; status: 'rascunho' | 'confirmado'; resumo: string | null; itens: ItemSemana[] }

const AREA = {
  saude: { nome: 'ClaudIA', app: 'claudia' }, financas: { nome: 'AIrton', app: 'airton' },
  aprender: { nome: 'SabIA', app: 'sabia' }, casa: { nome: 'Casa', app: 'casa' },
} as const
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const nomeDia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })

/** Pede um rascunho novo à IARA (a função responde na hora e escreve em ~1 min). */
export function Gerar({ rotulo, ghost }: { rotulo: string; ghost?: boolean }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function gerar() {
    setErro(null); setMsg('Montando a semana… (cerca de 1 min)')
    try {
      await callFunction('iara-semana', {})
      setTimeout(() => { setMsg(null); router.refresh() }, 60_000)
    } catch (e) { setMsg(null); setErro((e as Error).message) }
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <button className={`btn ${ghost ? 'ghost' : 'ai'}`} disabled={!!msg} onClick={gerar}>{msg ?? rotulo}</button>
      {erro && <p className="error">{erro}</p>}
    </div>
  )
}

export function Plano({ plano }: { plano: PlanoSemana }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const rascunho = plano.status === 'rascunho'
  const sb = () => supabaseBrowser() as unknown as SupabaseClient

  async function alternar(i: ItemSemana) {
    setBusy(`i${i.id}`); setErro(null)
    const { error } = await sb().rpc('hub_semana_item', { p_id: i.id, p_incluido: !i.incluido })
    setBusy(null)
    if (error) setErro('Não deu para salvar. Tente de novo.'); else router.refresh()
  }
  async function confirmar() {
    setBusy('ok'); setErro(null)
    const { error } = await sb().rpc('hub_semana_confirmar', { p_plano: plano.id })
    setBusy(null)
    if (error) setErro('Não deu para confirmar. Tente de novo.'); else router.refresh()
  }

  const dias = [...new Set(plano.itens.map((i) => i.data))]
  const incluidos = plano.itens.filter((i) => i.incluido).length
  return (
    <div className="stack">
      {erro && <p className="error">{erro}</p>}
      {dias.map((d) => (
        <section key={d} className="card stack" style={{ gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', textTransform: 'capitalize' }}>{nomeDia(d)}</h2>
          <ol className="semana">
            {plano.itens.filter((i) => i.data === d).map((i) => (
              <li key={i.id} data-app={AREA[i.area].app} className={i.incluido ? '' : 'fora'}>
                <span className="h">{i.hora ?? '—'}</span>
                <span className="t">
                  <strong>{i.titulo}</strong>
                  <small> · {AREA[i.area].nome}{i.minutos ? ` · ${i.minutos} min` : ''}{i.valor != null ? ` · ${brl(Number(i.valor))}` : ''}</small>
                  {i.status === 'feito' && <span className="feito">✓ feito</span>}
                  {i.detalhe && <span className="d">{i.detalhe}</span>}
                </span>
                {rascunho && (
                  <button className="chip" disabled={!!busy} onClick={() => alternar(i)} aria-label={i.incluido ? `Tirar ${i.titulo}` : `Voltar ${i.titulo}`}>
                    {i.incluido ? 'Tirar' : 'Voltar'}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {rascunho ? (
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn" disabled={!!busy || !incluidos} onClick={confirmar}>
            {busy === 'ok' ? 'Confirmando…' : `Confirmar a semana (${incluidos} ${incluidos === 1 ? 'item' : 'itens'})`}
          </button>
          <Gerar rotulo="Refazer o rascunho" ghost />
          <p className="small muted" style={{ margin: 0 }}>Ao confirmar, cada item vira tarefa do dia e aparece na linha do tempo da Hoje.</p>
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>Confirmado: os itens de cada dia aparecem na linha do tempo da Hoje.</p>}
    </div>
  )
}
