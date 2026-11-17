'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'
import { appDoAgent } from '@/components/SeuDia'
import { ddmm } from '../semana/tipos'

type MetaT = { id: number; horizonte: string; dono: string; titulo: string; medida?: unknown; prazo?: string | null; cadencia?: unknown; demanda?: unknown }
type Resposta = { pergunta: string; resposta: string }
type Resp = {
  fala?: string
  tela?: {
    plano?: { id: number; titulo: string; status: string; alvo?: { valor?: unknown; data?: string } | null; porque?: string | null }
    metas?: { longo?: MetaT[]; medio?: MetaT[]; curto?: MetaT[] }
    primeiro_passo?: { titulo: string; dono?: string; detalhe?: string } | null
    viabilidade?: { reais_mes_necessarios?: number; folga_mes?: number; cabe?: boolean } | null
    avisos?: string[]
  } | null
  pendente?: { tipo: 'pergunta' | 'confirmacao'; pergunta?: string; opcoes?: string[]; plano_id?: number } | null
}

const DONO: Record<string, string> = { iara: 'IARA', claudia: 'ClaudIA', airton: 'AIrton', sabia: 'SabIA' }
const HOR = [['longo', 'Longo prazo'], ['medio', 'Médio prazo'], ['curto', 'Curto prazo']] as const
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const txt = (v: unknown) => v == null ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v).replace(/[{}"]/g, '').replace(/,/g, ' · ')

/** Confirmar/Descartar um rascunho (usado na lista e na prévia). */
export function AcoesRascunho({ planoId, onFala }: { planoId: number; onFala?: (f: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function enviar(acao: 'confirmar' | 'descartar') {
    if (acao === 'descartar' && !window.confirm('Descartar este plano?')) return
    setBusy(acao); setErro(null)
    try {
      const r = await callFunction<Resp>('iara-plano', { acao, plano_id: planoId })
      if (r.fala) onFala?.(r.fala)
      router.refresh()
    } catch (e) { setErro((e as Error).message || 'Não consegui agora. Tente de novo.') }
    setBusy(null)
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <button className="btn" disabled={!!busy} onClick={() => enviar('confirmar')}>{busy === 'confirmar' ? 'Confirmando…' : 'Sim, confirmar'}</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => enviar('descartar')}>{busy === 'descartar' ? 'Descartando…' : 'Descartar'}</button>
      </div>
      {erro && <p className="error">{erro}</p>}
    </div>
  )
}

function MetaEditavel({ m }: { m: MetaT }) {
  const [edit, setEdit] = useState(false)
  const [titulo, setTitulo] = useState(m.titulo)
  const [prazo, setPrazo] = useState(m.prazo ?? '')
  const [salvo, setSalvo] = useState({ titulo: m.titulo, prazo: m.prazo ?? '' })
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  async function salvar() {
    setBusy(true); setErro(null)
    const p: Record<string, unknown> = { id: m.id, titulo }
    if (prazo) p.prazo = prazo
    const { error } = await (supabaseBrowser() as unknown as SupabaseClient).rpc('hub_meta_salvar', { p })
    setBusy(false)
    if (error) { setErro('Não deu para salvar. Tente de novo.'); return }
    setSalvo({ titulo, prazo }); setEdit(false)
  }
  return (
    <div data-app={appDoAgent(m.dono)} className="stack" style={{ gap: 4, borderLeft: '3px solid var(--accent)', paddingLeft: 10 }}>
      <div className="row between">
        <strong className="small">{salvo.titulo}</strong>
        <span className="small" style={{ color: 'var(--accent)' }}>{DONO[m.dono] ?? m.dono}</span>
      </div>
      <span className="small muted">
        {[txt(m.medida), salvo.prazo ? `prazo ${ddmm(salvo.prazo)}` : '', m.demanda ? `demanda ${txt(m.demanda)}` : ''].filter(Boolean).join(' · ')}
      </span>
      {edit ? (
        <div className="stack" style={{ gap: 6 }}>
          <input aria-label="Título da meta" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          <input aria-label="Prazo da meta" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          <div className="row">
            <button className="btn" disabled={busy || !titulo.trim()} onClick={salvar}>{busy ? 'Salvando…' : 'Salvar'}</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setEdit(false); setTitulo(salvo.titulo); setPrazo(salvo.prazo) }}>Cancelar</button>
          </div>
          {erro && <p className="error">{erro}</p>}
        </div>
      ) : (
        <button className="btn ghost" style={{ justifySelf: 'start', minHeight: 36, padding: '6px 12px' }} onClick={() => setEdit(true)}>Editar</button>
      )}
    </div>
  )
}

function Rascunho({ r, onFala }: { r: Resp; onFala: (f: string) => void }) {
  const t = r.tela!, p = t.plano!, v = t.viabilidade
  return (
    <section className="card ai stack" style={{ gap: 10 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{p.titulo}</h2>
        <span className="tag ai">Rascunho</span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {[p.alvo?.valor != null ? `alvo ${txt(p.alvo.valor)}` : '', p.alvo?.data ? `até ${ddmm(p.alvo.data)}` : ''].filter(Boolean).join(' · ')}
      </p>
      {p.porque && <p className="small" style={{ margin: 0 }}>Porque: {p.porque}</p>}
      {HOR.map(([h, nome]) => {
        const metas = t.metas?.[h] ?? []
        if (!metas.length) return null
        return (
          <div key={h} className="stack" style={{ gap: 8 }}>
            <span className="tag">{nome}</span>
            {metas.map((m) => <MetaEditavel key={m.id} m={m} />)}
          </div>
        )
      })}
      {t.primeiro_passo && (
        <p className="small" style={{ margin: 0 }}><strong>Primeiro passo:</strong> {t.primeiro_passo.titulo}{t.primeiro_passo.detalhe ? ` — ${t.primeiro_passo.detalhe}` : ''}</p>
      )}
      {v && (
        <p className="small" style={{ margin: 0, color: v.cabe === false ? 'var(--alert)' : undefined }}>
          {v.reais_mes_necessarios != null && `Precisa de ${brl(Number(v.reais_mes_necessarios))}/mês`}
          {v.folga_mes != null && `; sobra ${brl(Number(v.folga_mes))}`}
          {v.cabe === false && ' — não cabe no orçamento de hoje.'}
        </p>
      )}
      {(t.avisos ?? []).map((a, i) => <p key={i} className="small tag alert" style={{ margin: 0, textTransform: 'none' }}>{a}</p>)}
      <AcoesRascunho planoId={p.id} onFala={onFala} />
    </section>
  )
}

export function NovoPlano() {
  const router = useRouter()
  const [frase, setFrase] = useState('')
  const [enviada, setEnviada] = useState('')
  const [respostas, setRespostas] = useState<Resposta[]>([])
  const [livre, setLivre] = useState('')
  const [resp, setResp] = useState<Resp | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [fim, setFim] = useState<string | null>(null)

  async function criar(f: string, rs: Resposta[]) {
    setBusy(true); setErro(null); setFim(null)
    try {
      const r = await callFunction<Resp>('iara-plano', { acao: 'criar', frase: f, ...(rs.length ? { respostas: rs } : {}) })
      setEnviada(f); setRespostas(rs); setResp(r); setLivre('')
      if (r.tela?.plano && r.tela.plano.status !== 'rascunho') { setFim(r.fala ?? 'Plano pronto.'); setResp(null); setFrase(''); router.refresh() }
    } catch (e) { setErro((e as Error).message || 'Não consegui montar o plano agora.') }
    setBusy(false)
  }
  const responder = (a: string) => a.trim() && criar(enviada, [...respostas, { pergunta: resp?.pendente?.pergunta ?? resp?.fala ?? '', resposta: a.trim() }])
  const terminou = (f: string) => { setFim(f); setResp(null); setFrase(''); setRespostas([]) }

  const pergunta = resp?.pendente?.tipo === 'pergunta' ? resp.pendente : null
  const rascunho = resp?.tela?.plano?.status === 'rascunho' ? resp : null

  return (
    <section className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: '1rem' }}>Novo plano</h2>
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (frase.trim()) criar(frase.trim(), []) }}>
        <input aria-label="Novo plano" placeholder="Quero comprar um apartamento de 800 mil até 2030" value={frase} disabled={busy} onChange={(e) => setFrase(e.target.value)} />
        <button className="btn ai" disabled={busy || !frase.trim()} style={{ justifySelf: 'start' }}>{busy && !resp ? 'Enviando…' : 'Criar plano'}</button>
      </form>
      {busy && <p className="small muted" style={{ margin: 0 }}>A IARA está montando o plano… (10 a 20 s)</p>}
      {erro && <p className="error">{erro}</p>}
      {fim && <p className="small" style={{ margin: 0 }}>{fim}</p>}
      {pergunta && !busy && (
        <div className="stack" style={{ gap: 8 }}>
          <p style={{ margin: 0 }}>{resp?.fala ?? pergunta.pergunta}</p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(pergunta.opcoes ?? []).map((o) => <button key={o} className="btn ghost" onClick={() => responder(o)}>{o}</button>)}
          </div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); responder(livre) }}>
            <input aria-label="Outra resposta" placeholder="Ou escreva a resposta" value={livre} onChange={(e) => setLivre(e.target.value)} />
            <button className="btn" disabled={!livre.trim()}>Responder</button>
          </form>
        </div>
      )}
      {rascunho && !busy && <Rascunho r={rascunho} onFala={(f) => { terminou(f); router.refresh() }} />}
    </section>
  )
}
