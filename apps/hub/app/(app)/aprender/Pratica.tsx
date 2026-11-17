'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { Md } from '@/lib/md'

export type Habilidade = {
  id: number; nome: string; tipo: string; nivel: string | null; objetivo: string | null; curriculo: unknown
  alvo: number | null; minutos_semana: number; sequencia_dias: number
  ultimas: { id: number; data: string; minutos: number; nota: string | null }[]
  plano: { item_id: number; trilha_id: number; data: string; titulo: string; resumo: string | null; corpo: string | null } | null
}
export type Praticas = { semana: { inicio: string; fim: string }; habilidades: Habilidade[] }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const TIPOS: [string, string][] = [['instrumento', 'Instrumento'], ['idioma', 'Idioma'], ['carreira', 'Carreira'], ['outro', 'Outro']]
const JANELA_MS = 10 * 60 * 1000
const msgErro = (e: { message?: string } | null) => (e?.message && /^(Qual habilidade|Prática não|Habilidade não|minutos inválidos|nome obrigat)/.test(e.message) ? e.message : 'Não deu para salvar. Confira os campos e tente de novo.')
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Prática de habilidades (violão, inglês…) da SabIA. Toda ação devolve uma frase de confirmação. */
export function PraticaBloco({ dados, erro }: { dados: Praticas | null; erro: boolean }) {
  const router = useRouter()
  const [fala, setFala] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Habilidade | 'nova' | null>(null)
  const [desfazer, setDesfazer] = useState<{ id: number; ate: number } | null>(null)
  const [arquivar, setArquivar] = useState<number | null>(null)

  async function chamar(fn: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>, ok: (d: Record<string, unknown>) => string, depois?: (d: Record<string, unknown>) => void) {
    setBusy(true); setAviso(null)
    const { data, error } = await fn()
    setBusy(false)
    if (error) { setAviso(msgErro(error)); return }
    const d = (data ?? {}) as Record<string, unknown>
    setFala(ok(d)); depois?.(d); router.refresh()
  }

  if (erro) return <section className="card alert stack" style={{ gap: 6 }}><h2 style={{ margin: 0, fontSize: '1rem' }}>Prática</h2><p className="small" style={{ margin: 0 }}>Não consegui carregar suas práticas agora. Tente de novo em instantes.</p></section>
  if (!dados) return <section className="card"><p className="small muted" style={{ margin: 0 }}>Carregando práticas…</p></section>

  const hs = dados.habilidades
  const podeDesfazer = desfazer && Date.now() < desfazer.ate

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Prática</h2>
        {!form && <button className="chip" onClick={() => { setForm('nova'); setFala(null) }}>+ Habilidade</button>}
      </div>

      {fala && (
        <div className="row between" style={{ gap: 8 }}>
          <p className="small" role="status" style={{ margin: 0 }}>{fala}</p>
          {podeDesfazer && <button className="chip" disabled={busy} onClick={() => chamar(() => sb().rpc('hub_pratica_desfazer', { p_pratica: desfazer.id }), (d) => String(d.fala ?? 'Desfeito.'), () => setDesfazer(null))}>Desfazer</button>}
        </div>
      )}
      {aviso && <p className="error" role="alert">{aviso}</p>}

      {!hs.length && !form && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small" style={{ margin: 0 }}>Nenhuma prática ainda. Crie uma habilidade, como violão, e registre quanto você pratica.</p>
          <button className="btn" onClick={() => setForm('nova')}>+ Criar habilidade</button>
        </div>
      )}

      {hs.length > 0 && (
        <RegistrarPratica hs={hs} busy={busy} onRegistrar={(minutos, habilidade, nota) => chamar(
          () => sb().rpc('hub_pratica_registrar', { p_minutos: minutos, ...(habilidade ? { p_habilidade: habilidade } : {}), ...(nota ? { p_nota: nota } : {}) }),
          (d) => String(d.fala ?? 'Anotado.'),
          (d) => setDesfazer(typeof d.pratica_id === 'number' ? { id: d.pratica_id, ate: Date.now() + JANELA_MS } : null))} />
      )}

      {hs.map((h) => <HabilidadeCard key={h.id} h={h} busy={busy} arquivando={arquivar === h.id}
        onEditar={() => { setForm(h); setFala(null) }}
        onArquivar={() => setArquivar(h.id)} onCancelarArquivo={() => setArquivar(null)}
        onConfirmarArquivo={() => chamar(() => sb().rpc('hub_habilidade_salvar', { p: { id: h.id, ativa: false } }), () => `Arquivei "${h.nome}".`, () => setArquivar(null))} />)}

      {form && <HabilidadeForm key={form === 'nova' ? 'nova' : form.id} h={form === 'nova' ? null : form} busy={busy} onFechar={() => setForm(null)}
        onSalvar={(p) => chamar(() => sb().rpc('hub_habilidade_salvar', { p }), (d) => String(d.fala ?? 'Salvo.'), () => setForm(null))} />}
    </section>
  )
}

function RegistrarPratica({ hs, busy, onRegistrar }: { hs: Habilidade[]; busy: boolean; onRegistrar: (minutos: number, habilidade: string | null, nota: string) => void }) {
  const [min, setMin] = useState('')
  const [hab, setHab] = useState(hs.length === 1 ? hs[0].nome : '')
  const [nota, setNota] = useState('')
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (min) { onRegistrar(Number(min), hab || null, nota.trim()); setMin(''); setNota('') } }}>
      <div className="grid2">
        <input required inputMode="numeric" pattern="[0-9]*" placeholder="Minutos praticados" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="Minutos praticados" />
        <select value={hab} onChange={(e) => setHab(e.target.value)} aria-label="Habilidade">
          {hs.length > 1 && <option value="">Qual habilidade?</option>}
          {hs.map((h) => <option key={h.id} value={h.nome}>{h.nome}</option>)}
        </select>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} aria-label="Nota da prática" />
        <button className="btn" disabled={busy || !min}>{busy ? '…' : 'Registrar'}</button>
      </div>
    </form>
  )
}

function HabilidadeCard({ h, busy, arquivando, onEditar, onArquivar, onCancelarArquivo, onConfirmarArquivo }: {
  h: Habilidade; busy: boolean; arquivando: boolean; onEditar: () => void; onArquivar: () => void; onCancelarArquivo: () => void; onConfirmarArquivo: () => void
}) {
  const [corpo, setCorpo] = useState(false)
  const pct = h.alvo ? Math.min(100, Math.round((h.minutos_semana / h.alvo) * 100)) : null
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      <div className="row between" style={{ gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <strong>{h.nome}</strong>
          <p className="small muted" style={{ margin: 0 }}>
            {[h.alvo ? `${h.minutos_semana} de ${h.alvo} min nesta semana` : `${h.minutos_semana} min nesta semana`, h.sequencia_dias > 0 ? `${h.sequencia_dias} ${h.sequencia_dias === 1 ? 'dia' : 'dias'} seguidos` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="row" style={{ gap: 6, flexShrink: 0 }}>
          <button className="chip" onClick={onEditar} aria-label={`Editar ${h.nome}`}>Editar</button>
          <button className="chip" onClick={onArquivar} aria-label={`Arquivar ${h.nome}`}>Arquivar</button>
        </span>
      </div>
      {pct != null && <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} /></div>}
      {arquivando && (
        <div className="row between" style={{ gap: 8 }}>
          <span className="small">Arquivar "{h.nome}"? O histórico fica guardado.</span>
          <span className="row" style={{ gap: 6 }}>
            <button className="chip" disabled={busy} onClick={onConfirmarArquivo}>Arquivar</button>
            <button className="chip" onClick={onCancelarArquivo}>Cancelar</button>
          </span>
        </div>
      )}
      {h.ultimas.length > 0 ? (
        <div className="stack" style={{ gap: 2 }}>
          {h.ultimas.slice(0, 3).map((u) => <span key={u.id} className="small muted">{dm(u.data)} · {u.minutos} min{u.nota ? ` · ${u.nota}` : ''}</span>)}
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>Nenhuma prática registrada ainda.</p>}
      {h.plano && (
        <div className="card ai stack" style={{ gap: 6 }}>
          <span className="tag ai">Plano da semana</span>
          <strong>{h.plano.titulo}</strong>
          {h.plano.resumo && <p className="small" style={{ margin: 0 }}>{h.plano.resumo}</p>}
          {h.plano.corpo && (
            <>
              <button className="chip" style={{ alignSelf: 'flex-start' }} aria-expanded={corpo} onClick={() => setCorpo(!corpo)}>{corpo ? 'Ocultar plano' : 'Ver plano'}</button>
              {corpo && <Md texto={h.plano.corpo} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function HabilidadeForm({ h, busy, onSalvar, onFechar }: { h: Habilidade | null; busy: boolean; onSalvar: (p: Record<string, unknown>) => void; onFechar: () => void }) {
  const [f, setF] = useState({ nome: h?.nome ?? '', tipo: h?.tipo ?? 'instrumento', nivel: h?.nivel ?? '', objetivo: h?.objetivo ?? '', alvo: h?.alvo ? String(h.alvo) : '' })
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
      e.preventDefault()
      onSalvar({ ...(h ? { id: h.id } : {}), nome: f.nome, tipo: f.tipo, nivel: f.nivel || null, objetivo: f.objetivo || null, ...(f.alvo ? { minutos_semana_alvo: Number(f.alvo) } : {}) })
    }}>
      <input required placeholder="Habilidade (ex.: violão)" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} maxLength={80} />
      <div className="grid2">
        <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} aria-label="Tipo">{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <input inputMode="numeric" pattern="[0-9]*" placeholder="Minutos por semana" value={f.alvo} onChange={(e) => setF({ ...f, alvo: e.target.value.replace(/\D/g, '').slice(0, 4) })} aria-label="Minutos por semana" />
      </div>
      <input placeholder="Nível (ex.: iniciante)" value={f.nivel} onChange={(e) => setF({ ...f, nivel: e.target.value })} maxLength={80} />
      <input placeholder="Objetivo (opcional)" value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} maxLength={200} />
      <div className="grid2">
        <button className="btn" disabled={busy}>{busy ? 'Salvando…' : h ? 'Salvar habilidade' : 'Criar habilidade'}</button>
        <button type="button" className="btn ghost" onClick={onFechar}>Cancelar</button>
      </div>
    </form>
  )
}
