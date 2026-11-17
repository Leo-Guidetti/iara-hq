'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'
import { minutosAte, useAgora } from '@/lib/useAgora'
import { Revisar } from './Revisar'
import { DIA_CURTO, ddmm, diaSemana, nomeDia, type Fixo, type ItemSemana, type PlanoSemana } from './tipos'

export type { PlanoSemana } from './tipos'

const AREA = {
  saude: { nome: 'ClaudIA', app: 'claudia' }, financas: { nome: 'AIrton', app: 'airton' },
  aprender: { nome: 'SabIA', app: 'sabia' }, casa: { nome: 'Casa', app: 'casa' },
} as const
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Pede à IARA a sugestão inicial + crítica (a função responde na hora e escreve em ~1 min). */
export function Gerar({ rotulo, ghost }: { rotulo: string; ghost?: boolean }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function gerar() {
    setErro(null); setMsg('A IARA está encaixando a semana… (cerca de 1 min)')
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

type Linha = { tipo: 'fixo'; f: Fixo; hora: string | null } | { tipo: 'item'; i: ItemSemana; hora: string | null }

export function Plano({ plano, fixos, dias }: { plano: PlanoSemana; fixos: Fixo[]; dias: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<number | null>(null)
  const rascunho = plano.status === 'rascunho'
  const sb = () => supabaseBrowser() as unknown as SupabaseClient
  const [cartao, setCartao] = useState<{ id: number; pergunta: string; expira: string } | null>(null)
  const [desfazer, setDesfazer] = useState<{ id: number; ate: string } | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const agora = useAgora(!!(cartao || desfazer))

  // Confirmação pendente recuperada ao abrir a página (se ainda vale).
  useEffect(() => {
    sb().rpc('hub_acao_pendente').then(({ data }) => {
      const a = data as { acao_id: number; intencao: string; status: string; pergunta: string | null; expira_em: string; args?: { p_plano?: number } } | null
      if (a && a.intencao === 'semana.confirmar' && a.status === 'pendente' && Number(a.args?.p_plano) === plano.id && Date.parse(a.expira_em) > Date.now())
        setCartao({ id: a.acao_id, pergunta: a.pergunta ?? perguntaSemana, expira: a.expira_em })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plano.id])

  async function rpc(rotulo: string, fn: string, args: Record<string, unknown>) {
    setBusy(rotulo); setErro(null)
    const { error } = await sb().rpc(fn, args)
    setBusy(null)
    if (error) setErro('Não deu para salvar. Tente de novo.'); else { setEditando(null); router.refresh() }
  }

  const incluidos = plano.itens.filter((i) => i.incluido).length
  const porArea = (['saude', 'financas', 'aprender', 'casa'] as const)
    .map((a) => [a, plano.itens.filter((i) => i.incluido && i.area === a).length] as const).filter(([, n]) => n > 0)
    .map(([a, n]) => `${n} de ${AREA[a].nome}`)
  const perguntaSemana = `Confirmo a semana com ${incluidos} ${incluidos === 1 ? 'item' : 'itens'}${porArea.length ? ` (${porArea.join(', ')})` : ''}? Cada item vira tarefa do dia.`

  async function pedir() {
    setBusy('ok'); setErro(null); setAviso(null)
    const { data, error } = await sb().rpc('hub_acao_pedir', { p_intencao: 'semana.confirmar', p_args: { p_plano: plano.id }, p_canal: 'hub', p_pergunta: perguntaSemana })
    setBusy(null)
    const r = data as { acao_id?: number; pergunta?: string; expira_em?: string } | null
    if (error || !r?.acao_id || !r.expira_em) { setErro('Não deu para pedir a confirmação. Tente de novo.'); return }
    setCartao({ id: r.acao_id, pergunta: r.pergunta || perguntaSemana, expira: r.expira_em })
  }
  async function sim() {
    if (!cartao) return
    setBusy('sim'); setErro(null)
    const { data, error } = await sb().rpc('hub_acao_confirmar', { p_id: cartao.id })
    setBusy(null)
    const r = data as { status?: string; fala?: string; desfazer?: { acao_id: number; ate: string } | null } | null
    if (error || !r) { setErro('Não deu para confirmar. Tente de novo.'); return }
    setCartao(null)
    if (r.status === 'executada') { setDesfazer(r.desfazer ? { id: r.desfazer.acao_id, ate: r.desfazer.ate } : null); setAviso('Semana confirmada.'); router.refresh() }
    else setErro(r.fala || 'Essa confirmação não vale mais. Peça de novo.')
  }
  async function voltar() {
    if (!cartao) return
    const id = cartao.id
    setCartao(null)
    await sb().rpc('hub_acao_cancelar', { p_id: id })
  }
  async function desfazerSemana() {
    if (!desfazer) return
    setBusy('undo'); setErro(null)
    const { data, error } = await sb().rpc('hub_acao_desfazer', { p_id: desfazer.id })
    setBusy(null)
    const r = data as { ok?: boolean; fala?: string } | null
    if (error || !r) { setErro('Não consegui desfazer agora. Tente de novo.'); return }
    if (r.ok) { setDesfazer(null); setAviso(r.fala || 'Desfeito.'); router.refresh() } else setErro(r.fala || 'Não deu para desfazer.')
  }
  const linhasDo = (d: string): Linha[] => [
    ...fixos.filter((f) => f.data === d).map((f) => ({ tipo: 'fixo' as const, f, hora: f.inicio })),
    ...plano.itens.filter((i) => i.data === d).map((i) => ({ tipo: 'item' as const, i, hora: i.hora })),
  ].sort((a, b) => (a.hora ?? '99').localeCompare(b.hora ?? '99'))

  return (
    <div className="stack">
      {erro && <p className="error">{erro}</p>}
      <div className="semana-grade">
        {dias.map((d) => {
          const linhas = linhasDo(d)
          if (!linhas.length) return null
          return (
            <section key={d} className="card stack" style={{ gap: 8 }}>
              <h2 className="dia" style={{ margin: 0, fontSize: '1rem' }}>{nomeDia(d)}</h2>
              <ol className="semana">
                {linhas.map((l) => l.tipo === 'fixo' ? (
                  <li key={`f-${l.f.fonte}-${l.f.id}-${l.f.inicio}`} data-app="hq" className="fixo">
                    <span className="h">{l.f.inicio ?? 'dia'}</span>
                    <span className="t"><strong>{l.f.titulo}</strong>
                      <small>{[l.f.fim ? `até ${l.f.fim}` : null, l.f.local, l.f.fonte === 'expediente' ? 'expediente' : l.f.fonte === 'hub' ? 'seu compromisso' : 'agenda'].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span />
                  </li>
                ) : (
                  <li key={l.i.id} data-app={AREA[l.i.area].app} className={l.i.incluido ? '' : 'fora'}>
                    <span className="h">{l.i.hora ?? '—'}</span>
                    <span className="t">
                      <strong>{l.i.titulo}</strong>
                      <small>{[AREA[l.i.area].nome, l.i.minutos ? `${l.i.minutos} min` : null, l.i.valor != null ? brl(Number(l.i.valor)) : null].filter(Boolean).join(' · ')}</small>
                      {(l.i.plano || l.i.editado) && <span className="row" style={{ gap: 6 }}>{l.i.plano && <span className="tag">{l.i.plano}</span>}{l.i.editado && <span className="small muted">ajustado por você</span>}</span>}
                      {l.i.status === 'feito' && <span className="feito">✓ feito</span>}
                      {l.i.detalhe && <span className="d">{l.i.detalhe}</span>}
                      {editando === l.i.id && <Editar item={l.i} dias={dias} busy={!!busy} onSalvar={(data, hora) => rpc(`e${l.i.id}`, 'hub_semana_item_editar', { p_id: l.i.id, p_data: data, p_hora: hora })} onCancelar={() => setEditando(null)} />}
                    </span>
                    {rascunho && editando !== l.i.id && (
                      <span className="acoes">
                        {l.i.incluido && <button className="chip" disabled={!!busy} onClick={() => setEditando(l.i.id)}>Mover</button>}
                        <button className="chip" disabled={!!busy} onClick={() => rpc(`i${l.i.id}`, 'hub_semana_item', { p_id: l.i.id, p_incluido: !l.i.incluido })}>{l.i.incluido ? 'Tirar' : 'Voltar'}</button>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>
      {aviso && <p className="small" aria-live="polite" style={{ margin: 0 }}>{aviso}</p>}
      {desfazer && Date.parse(desfazer.ate) > agora && (
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn ghost" disabled={!!busy} onClick={desfazerSemana}>{busy === 'undo' ? 'Desfazendo…' : 'Desfazer'}</button>
          <span className="small muted">vale por {minutosAte(desfazer.ate, agora)} min</span>
        </div>
      )}
      {rascunho ? (
        <div className="stack semana-acoes" style={{ gap: 8 }}>
          {cartao && Date.parse(cartao.expira) > agora ? (
            <section className="card ai stack" style={{ gap: 8 }} aria-label="Confirmar a semana">
              <p style={{ margin: 0, fontWeight: 600 }}>{cartao.pergunta}</p>
              <p className="small muted" style={{ margin: 0 }}>Vale por {minutosAte(cartao.expira, agora)} min.</p>
              <div className="grid2">
                <button className="btn" disabled={!!busy} onClick={sim}>{busy === 'sim' ? 'Confirmando…' : 'Sim, confirmar'}</button>
                <button className="btn ghost" disabled={!!busy} onClick={voltar}>Voltar</button>
              </div>
            </section>
          ) : revisando ? (
            <Revisar planoId={plano.id} busy={!!busy} onConfirmar={pedir} onFechar={() => setRevisando(false)} />
          ) : (
            <button className="btn" disabled={!!busy || !incluidos} onClick={pedir}>
              {busy === 'ok' ? 'Preparando…' : `Confirmar a semana (${incluidos} ${incluidos === 1 ? 'item' : 'itens'})`}
            </button>
          )}
          {!revisando && !(cartao && Date.parse(cartao.expira) > agora) && <button className="btn ghost" disabled={!!busy} onClick={() => setRevisando(true)}>Revisar falando</button>}
          <Gerar rotulo="Sugerir de novo (com o que mudou)" ghost />
          <p className="small muted" style={{ margin: 0 }}>Ao confirmar, cada item vira tarefa do dia, entra na linha do tempo da Hoje e no link da agenda.</p>
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>Confirmado: os itens aparecem na linha do tempo da Hoje e no link da agenda.</p>}
    </div>
  )
}

function Editar({ item, dias, busy, onSalvar, onCancelar }: { item: ItemSemana; dias: string[]; busy: boolean; onSalvar: (data: string, hora: string) => void; onCancelar: () => void }) {
  const [data, setData] = useState(item.data)
  const [hora, setHora] = useState(item.hora ?? '')
  return (
    <span className="stack" style={{ gap: 6, marginTop: 6 }}>
      <span className="grid2">
        <select value={data} onChange={(e) => setData(e.target.value)} aria-label="Dia">
          {dias.map((d) => <option key={d} value={d}>{DIA_CURTO[diaSemana(d)]} {ddmm(d)}</option>)}
        </select>
        <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} aria-label="Hora" />
      </span>
      <span className="grid2">
        <button className="btn" disabled={busy} onClick={() => onSalvar(data, hora)}>Salvar</button>
        <button className="btn ghost" onClick={onCancelar}>Cancelar</button>
      </span>
    </span>
  )
}
