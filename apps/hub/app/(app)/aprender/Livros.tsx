'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type Livro = { id: number; titulo: string; autor: string | null; paginas: number | null; status: string }
export type Atual = Livro & { pagina_atual: number | null; comecou_em: string | null; ultima_leitura: string | null }
export type Livros = {
  atual: Atual | null; fila: Livro[]; lidos: { id: number; titulo: string; autor: string | null; paginas: number | null; nota: number | null; terminou_em: string | null }[]
  meta_ano: number | null; lidos_ano: number; paginas_dia: number | null
}

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const STATUS: [string, string][] = [['quero_ler', 'Quero ler'], ['lendo', 'Lendo'], ['pausado', 'Pausado'], ['lido', 'Lido'], ['abandonado', 'Abandonado']]
const msgErro = (e: { message?: string } | null) => (e?.message && /^(Nenhum livro|Livro não)/.test(e.message) ? e.message : 'Não deu para salvar. Confira os campos e tente de novo.')

/** Livros e meta do ano da SabIA. Toda ação devolve uma frase de confirmação. */
export function LivrosBloco({ dados, erro }: { dados: Livros | null; erro: boolean }) {
  const router = useRouter()
  const [fala, setFala] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Livro | 'novo' | null>(null)
  const [metaAberta, setMetaAberta] = useState(false)

  async function chamar(fn: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>, ok: (d: Record<string, unknown>) => string, depois?: () => void) {
    setBusy(true); setAviso(null)
    const { data, error } = await fn()
    setBusy(false)
    if (error) { setAviso(msgErro(error)); return }
    setFala(ok((data ?? {}) as Record<string, unknown>)); depois?.(); router.refresh()
  }

  if (erro) return <section className="card alert stack" style={{ gap: 6 }}><h2 style={{ margin: 0, fontSize: '1rem' }}>Livros</h2><p className="small" style={{ margin: 0 }}>Não consegui carregar seus livros agora. Tente de novo em instantes.</p></section>
  if (!dados) return <section className="card"><p className="small muted" style={{ margin: 0 }}>Carregando livros…</p></section>

  const { atual, fila, meta_ano, lidos_ano, paginas_dia } = dados
  const pct = atual?.paginas ? Math.min(100, Math.round(((atual.pagina_atual ?? 0) / atual.paginas) * 100)) : null
  const vazio = !atual && !fila.length && !dados.lidos.length

  return (
    <section className="card stack" style={{ gap: 12 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Livros</h2>
        {!form && <button className="chip" onClick={() => { setForm('novo'); setFala(null) }}>+ Livro</button>}
      </div>

      {fala && <p className="small" role="status" style={{ margin: 0 }}>{fala}</p>}
      {aviso && <p className="error" role="alert">{aviso}</p>}

      {/* Meta do ano */}
      {meta_ano ? (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row between">
            <span><strong>{lidos_ano} de {meta_ano}</strong> no ano</span>
            <button className="chip" onClick={() => setMetaAberta(!metaAberta)}>Meta</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{paginas_dia === 0 ? 'Meta do ano batida.' : paginas_dia != null ? `${paginas_dia} páginas por dia para fechar a meta.` : ''}</p>
        </div>
      ) : (
        <div className="row between">
          <p className="small muted" style={{ margin: 0 }}>Quantos livros quer ler neste ano?</p>
          <button className="chip" onClick={() => setMetaAberta(true)}>Definir meta</button>
        </div>
      )}
      {metaAberta && <MetaForm atual={meta_ano} busy={busy} onSalvar={(n) => chamar(() => sb().rpc('hub_livro_salvar', { p: { meta_ano: n } }), () => (n ? `Meta do ano: ${n} livros.` : 'Meta do ano removida.'), () => setMetaAberta(false))} onFechar={() => setMetaAberta(false)} />}

      {/* Livro atual */}
      {atual ? (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            <strong>{atual.titulo}</strong>
            <p className="small muted" style={{ margin: 0 }}>{[atual.autor, atual.paginas ? `página ${atual.pagina_atual ?? 0} de ${atual.paginas}${pct != null ? ` (${pct}%)` : ''}` : `página ${atual.pagina_atual ?? 0}`].filter(Boolean).join(' · ')}</p>
          </div>
          {pct != null && <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} /></div>}
          <Registrar atual={atual} busy={busy} onRegistrar={(p) => chamar(() => sb().rpc('hub_leitura_registrar', { p_pagina: p, p_livro: atual.id }), (d) => String(d.fala ?? 'Anotado.'))} />
          <button className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setForm(atual)}>Editar livro</button>
        </div>
      ) : !vazio ? <p className="small muted" style={{ margin: 0 }}>Nenhum livro em leitura. Comece um da fila.</p> : null}

      {vazio && !form && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small" style={{ margin: 0 }}>Nenhum livro ainda. Adicione o que está lendo para acompanhar o progresso.</p>
          <button className="btn" onClick={() => setForm('novo')}>+ Adicionar livro</button>
        </div>
      )}

      {/* Fila */}
      {fila.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="tag">Fila</span>
          {fila.map((l) => (
            <div key={l.id} className="row between" style={{ gap: 8 }}>
              <span className="small" style={{ minWidth: 0 }}>{l.titulo}{l.autor ? <span className="muted"> · {l.autor}</span> : null}{l.status === 'pausado' ? <span className="muted"> · pausado</span> : null}</span>
              <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                <button className="chip" disabled={busy} onClick={() => chamar(() => sb().rpc('hub_livro_salvar', { p: { id: l.id, status: 'lendo' } }), () => `Começou "${l.titulo}".`)}>Ler</button>
                <button className="chip" onClick={() => setForm(l)} aria-label={`Editar ${l.titulo}`}>Editar</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {form && <LivroForm key={form === 'novo' ? 'novo' : form.id} livro={form === 'novo' ? null : form} busy={busy} onFechar={() => setForm(null)}
        onSalvar={(p) => chamar(() => sb().rpc('hub_livro_salvar', { p }), (d) => { const t = (d.livro as { titulo?: string } | null)?.titulo; return t ? `Salvei "${t}".` : 'Salvo.' }, () => setForm(null))} />}
    </section>
  )
}

function Registrar({ atual, busy, onRegistrar }: { atual: Atual; busy: boolean; onRegistrar: (p: number) => void }) {
  const [p, setP] = useState('')
  return (
    <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (p) { onRegistrar(Number(p)); setP('') } }}>
      <input required inputMode="numeric" pattern="[0-9]*" placeholder="Li até a página…" value={p} onChange={(e) => setP(e.target.value.replace(/\D/g, '').slice(0, 5))} aria-label={`Li até a página (de ${atual.titulo})`} />
      <button className="btn" disabled={busy || !p}>{busy ? '…' : 'Registrar'}</button>
    </form>
  )
}

function MetaForm({ atual, busy, onSalvar, onFechar }: { atual: number | null; busy: boolean; onSalvar: (n: number) => void; onFechar: () => void }) {
  const [n, setN] = useState(atual ? String(atual) : '')
  return (
    <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); onSalvar(Number(n)) }}>
      <input required inputMode="numeric" pattern="[0-9]*" placeholder="Livros no ano" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Meta de livros no ano" />
      <button className="btn" disabled={busy || !n}>Salvar</button>
      <button type="button" className="btn ghost" onClick={onFechar}>Fechar</button>
    </form>
  )
}

function LivroForm({ livro, busy, onSalvar, onFechar }: { livro: Livro | null; busy: boolean; onSalvar: (p: Record<string, unknown>) => void; onFechar: () => void }) {
  const [f, setF] = useState({ titulo: livro?.titulo ?? '', autor: livro?.autor ?? '', paginas: livro?.paginas ? String(livro.paginas) : '', status: livro?.status ?? 'quero_ler' })
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
      e.preventDefault()
      onSalvar({ ...(livro ? { id: livro.id } : {}), titulo: f.titulo, autor: f.autor || null, ...(f.paginas ? { paginas: Number(f.paginas) } : {}), status: f.status })
    }}>
      <input required placeholder="Título" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={160} />
      <input placeholder="Autor (opcional)" value={f.autor} onChange={(e) => setF({ ...f, autor: e.target.value })} maxLength={120} />
      <div className="grid2">
        <input inputMode="numeric" pattern="[0-9]*" placeholder="Páginas" value={f.paginas} onChange={(e) => setF({ ...f, paginas: e.target.value.replace(/\D/g, '').slice(0, 5) })} aria-label="Total de páginas" />
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Situação">{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="grid2">
        <button className="btn" disabled={busy}>{busy ? 'Salvando…' : livro ? 'Salvar livro' : 'Adicionar livro'}</button>
        <button type="button" className="btn ghost" onClick={onFechar}>Cancelar</button>
      </div>
    </form>
  )
}
