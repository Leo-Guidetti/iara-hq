'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'

export type Formato = 'fisico' | 'kindle' | 'audiobook'
export type Livro = { id: number; titulo: string; autor: string | null; paginas: number | null; status: string; formato?: Formato | null; capa_url?: string | null }
export type Atual = Livro & { pagina_atual: number | null; comecou_em: string | null; ultima_leitura: string | null }
export type Livros = {
  atual: Atual | null; fila: Livro[]; lidos: (Livro & { nota: number | null; terminou_em: string | null })[]
  meta_ano: number | null; lidos_ano: number; paginas_dia: number | null
}
type Achado = { google_id: string; titulo: string; autor: string | null; paginas: number | null; idioma: string | null; capa_url: string | null }

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const FORMATOS: [Formato, string][] = [['fisico', 'Físico'], ['kindle', 'Kindle'], ['audiobook', 'Áudio']]
const NOME_FORMATO: Record<Formato, string> = { fisico: 'Físico', kindle: 'Kindle', audiobook: 'Áudio' }
const STATUS: [string, string][] = [['quero_ler', 'Quero ler'], ['lendo', 'Lendo'], ['pausado', 'Pausado'], ['lido', 'Lido'], ['abandonado', 'Abandonado']]
const IDIOMA: Record<string, string> = { pt: 'português', en: 'inglês', es: 'espanhol', fr: 'francês', it: 'italiano', de: 'alemão' }
const msgErro = (e: { message?: string } | null) => (e?.message && /^(Nenhum livro|Livro não)/.test(e.message) ? e.message : 'Não deu para salvar. Confira os campos e tente de novo.')
/** Kindle e áudio contam em %: o banco guarda a página equivalente (precisa do total de páginas). */
const emPct = (l: { formato?: Formato | null; paginas: number | null }) => l.formato !== 'fisico' && l.formato != null && !!l.paginas

/** Busca no Google Books direto do navegador (API pública, sem chave); se a cota anônima acabar, Open Library. */
async function buscarLivros(q: string): Promise<Achado[]> {
  try { return await googleBooks(q) } catch { return openLibrary(q) }
}

async function googleBooks(q: string): Promise<Achado[]> {
  const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=6&printType=books`)
  if (!r.ok) throw new Error('google')
  const j = (await r.json()) as { items?: { id: string; volumeInfo?: { title?: string; authors?: string[]; pageCount?: number; language?: string; imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }[] }
  return (j.items ?? []).filter((i) => i.volumeInfo?.title).map((i) => {
    const v = i.volumeInfo!
    const capa = v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail ?? null
    return {
      google_id: i.id, titulo: v.title!.slice(0, 160), autor: v.authors?.join(', ').slice(0, 120) ?? null,
      paginas: v.pageCount && v.pageCount > 0 ? v.pageCount : null, idioma: v.language ?? null,
      capa_url: capa ? capa.replace(/^http:/, 'https:').replace('&edge=curl', '') : null,
    }
  })
}

const OL_IDIOMA: Record<string, string> = { por: 'pt', eng: 'en', spa: 'es', fre: 'fr', ita: 'it', ger: 'de' }
async function openLibrary(q: string): Promise<Achado[]> {
  const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6&fields=key,title,author_name,number_of_pages_median,language,cover_i`)
  if (!r.ok) throw new Error('openlibrary')
  const j = (await r.json()) as { docs?: { key: string; title?: string; author_name?: string[]; number_of_pages_median?: number; language?: string[]; cover_i?: number }[] }
  return (j.docs ?? []).filter((d) => d.title).map((d) => ({
    google_id: `ol:${d.key}`, titulo: d.title!.slice(0, 160), autor: d.author_name?.slice(0, 2).join(', ').slice(0, 120) ?? null,
    paginas: d.number_of_pages_median ?? null, idioma: OL_IDIOMA[d.language?.[0] ?? ''] ?? null,
    capa_url: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
  }))
}

function Capa({ url, titulo, largura = 72 }: { url?: string | null; titulo: string; largura?: number }) {
  const estilo = { width: largura, aspectRatio: '2 / 3', borderRadius: 10, flex: 'none', objectFit: 'cover' as const, background: 'linear-gradient(160deg, var(--surface-3), var(--surface-2))' }
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={`Capa de ${titulo}`} loading="lazy" style={estilo} /> : <div role="img" aria-label={`Sem capa: ${titulo}`} style={estilo} />
}

/** Livros e meta do ano da SabIA. Toda ação devolve uma frase de confirmação. */
export function LivrosBloco({ dados, erro }: { dados: Livros | null; erro: boolean }) {
  const router = useRouter()
  const [fala, setFala] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Livro | null>(null)
  const [metaAberta, setMetaAberta] = useState(false)

  async function chamar(fn: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>, ok: (d: Record<string, unknown>) => string, depois?: () => void) {
    setBusy(true); setAviso(null)
    const { data, error } = await fn()
    setBusy(false)
    if (error) { setAviso(msgErro(error)); return }
    setFala(ok((data ?? {}) as Record<string, unknown>)); depois?.(); router.refresh()
  }
  const salvar = (p: Record<string, unknown>, depois?: () => void) =>
    chamar(() => sb().rpc('hub_livro_salvar', { p }), (d) => { const t = (d.livro as { titulo?: string } | null)?.titulo; return t ? `Salvei "${t}".` : 'Salvo.' }, depois)

  if (erro) return <section className="card alert"><p className="small" style={{ margin: 0 }}>Não consegui carregar seus livros agora. Tente de novo em instantes.</p></section>
  if (!dados) return <section className="card"><p className="small muted" style={{ margin: 0 }}>Carregando livros…</p></section>

  const { atual, fila, meta_ano, lidos_ano, paginas_dia } = dados
  const pct = atual?.paginas ? Math.min(100, Math.round(((atual.pagina_atual ?? 0) / atual.paginas) * 100)) : null

  return (
    <>
      {fala && <p className="small" role="status" style={{ margin: 0 }}>{fala}</p>}
      {aviso && <p className="error" role="alert">{aviso}</p>}

      {atual ? (
        <>
          <section className="card row" aria-label="Lendo agora" style={{ gap: 16, alignItems: 'stretch' }}>
            <Capa url={atual.capa_url} titulo={atual.titulo} largura={84} />
            <div style={{ flex: 1, minWidth: 0, display: 'grid', alignContent: 'space-between', gap: 8 }}>
              <div>
                <span className="small" style={{ color: 'var(--accent)' }}>Lendo{atual.formato ? ` · ${NOME_FORMATO[atual.formato]}` : ''}</span>
                <div style={{ fontWeight: 500, marginTop: 2 }}>{atual.titulo}</div>
                {atual.autor && <div className="small muted">{atual.autor}</div>}
              </div>
              <div>
                <div className="barra" aria-hidden="true"><i style={{ width: `${pct ?? 0}%` }} /></div>
                <div className="row between small" style={{ marginTop: 6 }}>
                  <span>{pct != null ? `${pct}%` : `página ${atual.pagina_atual ?? 0}`}</span>
                  <span style={{ color: 'var(--dim)' }}>{paginas_dia ? `meta: ${paginas_dia} págs/dia` : paginas_dia === 0 ? 'meta do ano batida' : ''}</span>
                </div>
              </div>
            </div>
          </section>
          <Registrar atual={atual} busy={busy} onRegistrar={(p) => chamar(() => sb().rpc('hub_leitura_registrar', { p_pagina: p, p_livro: atual.id }), (d) => String(d.fala ?? 'Anotado.'))} />
          <button className="chip" style={{ justifySelf: 'start' }} onClick={() => setForm(atual)}>Editar livro</button>
        </>
      ) : <p className="small muted" style={{ margin: 0 }}>{fila.length ? 'Nenhum livro em leitura. Comece um da fila.' : 'Nenhum livro ainda. Busque abaixo o que está lendo.'}</p>}

      {form && <LivroForm key={form.id} livro={form} busy={busy} onFechar={() => setForm(null)} onSalvar={(p) => salvar(p, () => setForm(null))} />}

      <Adicionar busy={busy} onAdicionar={(a, formato, lendo) => salvar({ titulo: a.titulo, autor: a.autor, ...(a.paginas ? { paginas: a.paginas } : {}), capa_url: a.capa_url, google_id: a.google_id, formato, status: lendo ? 'lendo' : 'quero_ler' })} />

      {fila.length > 0 && (
        <section className="card" aria-label="Fila de leitura">
          <div className="small muted">Fila</div>
          <div className="list" style={{ marginTop: 4 }}>
            {fila.map((l) => (
              <div key={l.id} className="row" style={{ gap: 12 }}>
                <Capa url={l.capa_url} titulo={l.titulo} largura={32} />
                <span className="small" style={{ flex: 1, minWidth: 0 }}>{l.titulo}{l.autor ? <span className="muted"> · {l.autor}</span> : null}{l.status === 'pausado' ? <span className="muted"> · pausado</span> : null}</span>
                <button className="chip" disabled={busy} onClick={() => chamar(() => sb().rpc('hub_livro_salvar', { p: { id: l.id, status: 'lendo' } }), () => `Começou "${l.titulo}".`)}>Ler</button>
                <button className="chip" onClick={() => setForm(l)} aria-label={`Editar ${l.titulo}`}>Editar</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card" aria-label="Meta do ano">
        <div className="row between">
          <span className="small">{meta_ano ? <><strong>{lidos_ano} de {meta_ano}</strong> livros no ano</> : <span className="muted">Quantos livros quer ler neste ano?</span>}</span>
          <button className="chip" onClick={() => setMetaAberta(!metaAberta)}>{meta_ano ? 'Meta' : 'Definir meta'}</button>
        </div>
        {meta_ano ? <div className="barra" style={{ marginTop: 10 }} aria-hidden="true"><i style={{ width: `${Math.min(100, (lidos_ano / meta_ano) * 100)}%` }} /></div> : null}
        {metaAberta && <div style={{ marginTop: 10 }}><MetaForm atual={meta_ano} busy={busy} onSalvar={(n) => chamar(() => sb().rpc('hub_livro_salvar', { p: { meta_ano: n } }), () => (n ? `Meta do ano: ${n} livros.` : 'Meta do ano removida.'), () => setMetaAberta(false))} onFechar={() => setMetaAberta(false)} /></div>}
      </section>
    </>
  )
}

function Registrar({ atual, busy, onRegistrar }: { atual: Atual; busy: boolean; onRegistrar: (pagina: number) => void }) {
  const pct = emPct(atual)
  const [v, setV] = useState('')
  return (
    <form className="card row" aria-label="Registrar progresso" style={{ gap: 10 }} onSubmit={(e) => {
      e.preventDefault(); if (!v) return
      const n = Number(v)
      onRegistrar(pct ? Math.round((Math.min(100, n) / 100) * atual.paginas!) : n); setV('')
    }}>
      <label className="row small" style={{ gap: 8, flex: 1 }}>
        <span className="muted">Li até</span>
        <input required inputMode="numeric" pattern="[0-9]*" placeholder={pct ? '%' : 'página'} value={v} style={{ width: 90 }}
          onChange={(e) => setV(e.target.value.replace(/\D/g, '').slice(0, pct ? 3 : 5))} aria-label={pct ? 'Progresso em %' : `Página (de ${atual.titulo})`} />
        <span className="muted">{pct ? '%' : atual.paginas ? `de ${atual.paginas}` : ''}</span>
      </label>
      <button className="btn" disabled={busy || !v}>{busy ? '…' : 'Salvar'}</button>
    </form>
  )
}

/** Adicionar livro: busca no Google Books, escolhe o formato e adiciona (à fila ou já lendo). */
function Adicionar({ busy, onAdicionar }: { busy: boolean; onAdicionar: (a: Achado, formato: Formato, lendo: boolean) => void }) {
  const [q, setQ] = useState('')
  const [achados, setAchados] = useState<Achado[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [falhou, setFalhou] = useState(false)
  const [formato, setFormato] = useState<Formato>('kindle')
  const [manual, setManual] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (t.current) clearTimeout(t.current)
    if (q.trim().length < 3) { setAchados(null); return }
    t.current = setTimeout(async () => {
      setBuscando(true); setFalhou(false)
      try { setAchados(await buscarLivros(q.trim())) } catch { setFalhou(true); setAchados(null) }
      setBuscando(false)
    }, 400)
    return () => { if (t.current) clearTimeout(t.current) }
  }, [q])

  return (
    <section className="card stack" aria-label="Adicionar livro" style={{ gap: 10 }}>
      <label className="small muted" htmlFor="busca-livro">Adicionar livro</label>
      <input id="busca-livro" type="search" placeholder="Título ou autor" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      <div className="tabs" role="radiogroup" aria-label="Formato" style={{ margin: 0 }}>
        {FORMATOS.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={formato === v} aria-current={formato === v ? 'page' : undefined} onClick={() => setFormato(v)}>{l}</button>)}
      </div>
      {buscando && <p className="small muted" style={{ margin: 0 }}>Buscando…</p>}
      {falhou && <p className="small muted" style={{ margin: 0 }}>A busca não respondeu. <button className="chip" type="button" onClick={() => setManual(true)}>Adicionar à mão</button></p>}
      {achados && !achados.length && <p className="small muted" style={{ margin: 0 }}>Nada encontrado. <button className="chip" type="button" onClick={() => setManual(true)}>Adicionar à mão</button></p>}
      {achados?.map((a) => (
        <div key={a.google_id} className="row" style={{ gap: 12 }}>
          <Capa url={a.capa_url} titulo={a.titulo} largura={40} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="small" style={{ display: 'block' }}>{a.titulo}</span>
            <span className="small" style={{ color: 'var(--dim)' }}>{[a.autor, a.idioma ? IDIOMA[a.idioma] ?? a.idioma : null, a.paginas ? `${a.paginas} págs` : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="row" style={{ gap: 6, flex: 'none' }}>
            <button className="chip" disabled={busy} onClick={() => { onAdicionar(a, formato, false); setQ('') }} aria-label={`Pôr ${a.titulo} na fila`}>Fila</button>
            <button className="chip on" disabled={busy} onClick={() => { onAdicionar(a, formato, true); setQ('') }} aria-label={`Começar a ler ${a.titulo}`}>Ler</button>
          </span>
        </div>
      ))}
      {manual && <LivroForm livro={null} formatoInicial={formato} titulo={q} busy={busy} onFechar={() => setManual(false)}
        onSalvar={(p) => { onAdicionar({ google_id: '', titulo: String(p.titulo), autor: (p.autor as string) ?? null, paginas: (p.paginas as number) ?? null, idioma: null, capa_url: null }, (p.formato as Formato) ?? formato, p.status === 'lendo'); setManual(false); setQ('') }} />}
    </section>
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

function LivroForm({ livro, busy, onSalvar, onFechar, formatoInicial, titulo }: { livro: Livro | null; busy: boolean; onSalvar: (p: Record<string, unknown>) => void; onFechar: () => void; formatoInicial?: Formato; titulo?: string }) {
  const [f, setF] = useState({ titulo: livro?.titulo ?? titulo ?? '', autor: livro?.autor ?? '', paginas: livro?.paginas ? String(livro.paginas) : '', status: livro?.status ?? 'quero_ler', formato: livro?.formato ?? formatoInicial ?? 'fisico' })
  return (
    <form className="card stack" style={{ gap: 8 }} onSubmit={(e) => {
      e.preventDefault()
      onSalvar({ ...(livro ? { id: livro.id } : {}), titulo: f.titulo, autor: f.autor || null, ...(f.paginas ? { paginas: Number(f.paginas) } : {}), status: f.status, formato: f.formato })
    }}>
      <input required placeholder="Título" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={160} />
      <input placeholder="Autor (opcional)" value={f.autor} onChange={(e) => setF({ ...f, autor: e.target.value })} maxLength={120} />
      <div className="grid2">
        <input inputMode="numeric" pattern="[0-9]*" placeholder="Páginas" value={f.paginas} onChange={(e) => setF({ ...f, paginas: e.target.value.replace(/\D/g, '').slice(0, 5) })} aria-label="Total de páginas" />
        <select value={f.formato} onChange={(e) => setF({ ...f, formato: e.target.value as Formato })} aria-label="Formato">{FORMATOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Situação">{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <div className="grid2">
        <button className="btn" disabled={busy}>{busy ? 'Salvando…' : livro ? 'Salvar livro' : 'Adicionar livro'}</button>
        <button type="button" className="btn ghost" onClick={onFechar}>Cancelar</button>
      </div>
    </form>
  )
}
