'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseBrowser } from '@/lib/supabase/client'
import { callFunction } from '@/lib/functions'
import { FUNCTIONS_URL } from '@/lib/env'
import { DIA_CURTO, ddmm, nomeDia, type Expediente, type Fixo, type Lugar, type Painel } from './tipos'

const sb = () => supabaseBrowser() as unknown as SupabaseClient
const TIPOS: [Fixo['tipo'], string][] = [['pessoal', 'Pessoal'], ['trabalho', 'Trabalho'], ['saude', 'Saúde'], ['outro', 'Outro']]

function useSalvar() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  async function salvar(rotulo: string, fn: () => PromiseLike<{ error: unknown }>, depois?: () => void) {
    setBusy(rotulo); setErro(null)
    const { error } = await fn()
    setBusy(null)
    if (error) setErro('Não deu para salvar. Confira os campos e tente de novo.')
    else { depois?.(); router.refresh() }
  }
  return { busy, erro, salvar }
}

/** O que é do Leo: expediente, lugares (com deslocamento), compromissos e agenda. A IARA encaixa o resto em volta. */
export function Entrada({ painel }: { painel: Painel }) {
  const compromissos = painel.fixos.filter((f) => f.fonte !== 'expediente')
  return (
    <div className="stack">
      <ExpedienteCard expediente={painel.expediente} lugares={painel.lugares} />
      <section className="card stack" style={{ gap: 10 }}>
        <div className="row between">
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Seus compromissos</h2>
          <span className="small muted">{ddmm(painel.desde)} a {ddmm(painel.fim)}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Jantares, bares, dates, médico, reuniões… A IARA não marca nada por cima e conta o deslocamento.</p>
        {compromissos.length ? (
          <ol className="semana">{compromissos.map((f) => <LinhaFixo key={`${f.fonte}-${f.id}-${f.data}-${f.inicio}`} f={f} />)}</ol>
        ) : <p className="small muted" style={{ margin: 0 }}>Nenhum compromisso ainda.</p>}
        <NovoCompromisso desde={painel.desde} fim={painel.fim} lugares={painel.lugares} />
      </section>
      <LugaresCard lugares={painel.lugares} />
      <AgendaCard painel={painel} />
    </div>
  )
}

function LinhaFixo({ f }: { f: Fixo }) {
  const { busy, salvar } = useSalvar()
  const daAgenda = f.fonte !== 'hub'
  return (
    <li data-app="hq" className="fixo">
      <span className="h">{f.inicio ?? 'dia'}</span>
      <span className="t">
        <strong>{f.titulo}</strong>
        <small>{[nomeDia(f.data), f.fim ? `até ${f.fim}` : null, f.local, daAgenda ? `agenda (${f.fonte})` : null].filter(Boolean).join(' · ')}</small>
      </span>
      {!daAgenda && f.id != null && (
        <button className="chip" disabled={!!busy} onClick={() => salvar('c', () => sb().rpc('hub_compromisso_cancelar', { p_id: f.id }))}>Cancelar</button>
      )}
    </li>
  )
}

function NovoCompromisso({ desde, fim, lugares }: { desde: string; fim: string; lugares: Lugar[] }) {
  const { busy, erro, salvar } = useSalvar()
  const vazio = { data: desde, inicio: '', fim: '', titulo: '', tipo: 'pessoal' as Fixo['tipo'], local: '' }
  const [c, setC] = useState(vazio)
  const set = (k: keyof typeof vazio) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value })
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); salvar('n', () => sb().rpc('hub_compromisso_salvar', { p: c }), () => setC({ ...vazio, data: c.data })) }}>
      <input required placeholder="Ex.: Jantar com a Ana, Bar com o time, Dentista" value={c.titulo} onChange={set('titulo')} maxLength={120} />
      <div className="grid2">
        <input type="date" required min={desde} value={c.data} onChange={set('data')} aria-label="Dia" />
        <select value={c.tipo} onChange={set('tipo')} aria-label="Tipo">{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="grid2">
        <input type="time" value={c.inicio} onChange={set('inicio')} aria-label="Início" />
        <input type="time" value={c.fim} onChange={set('fim')} aria-label="Fim" />
      </div>
      <input placeholder="Local (para o deslocamento)" list="lugares" value={c.local} onChange={set('local')} maxLength={200} />
      <datalist id="lugares">{lugares.map((l) => <option key={l.nome} value={l.nome} />)}</datalist>
      <button className="btn" disabled={!!busy}>{busy ? 'Salvando…' : '+ Adicionar compromisso'}</button>
      {c.data > fim && <p className="small muted" style={{ margin: 0 }}>Fica guardado para a semana dele.</p>}
      {erro && <p className="error">{erro}</p>}
    </form>
  )
}

function ExpedienteCard({ expediente, lugares }: { expediente: Expediente; lugares: Lugar[] }) {
  const { busy, erro, salvar } = useSalvar()
  const [aberto, setAberto] = useState(!expediente)
  const [e, setE] = useState({ dias: expediente?.dias ?? [1, 2, 3, 4, 5], inicio: expediente?.inicio ?? '09:00', fim: expediente?.fim ?? '18:00', local: expediente?.local ?? '' })
  const dias = (expediente?.dias ?? []).map((d) => DIA_CURTO[d % 7]).join(', ')
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <div className="row between">
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Expediente</h2>
        {expediente && !aberto && <button className="chip" onClick={() => setAberto(true)}>Editar</button>}
      </div>
      {expediente && !aberto && <p className="small" style={{ margin: 0 }}>{dias} · {expediente.inicio}–{expediente.fim}{expediente.local ? ` · ${expediente.local}` : ''}</p>}
      {aberto && (
        <form className="stack" style={{ gap: 8 }} onSubmit={(ev) => { ev.preventDefault(); salvar('e', () => sb().rpc('hub_expediente_salvar', { p: e }), () => setAberto(false)) }}>
          <div className="chips" role="group" aria-label="Dias de trabalho">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button type="button" key={d} className={`chip${e.dias.includes(d) ? ' on' : ''}`} aria-pressed={e.dias.includes(d)}
                onClick={() => setE({ ...e, dias: e.dias.includes(d) ? e.dias.filter((x) => x !== d) : [...e.dias, d].sort() })}>{DIA_CURTO[d % 7]}</button>
            ))}
          </div>
          <div className="grid2">
            <input type="time" required value={e.inicio} onChange={(ev) => setE({ ...e, inicio: ev.target.value })} aria-label="Entrada" />
            <input type="time" required value={e.fim} onChange={(ev) => setE({ ...e, fim: ev.target.value })} aria-label="Saída" />
          </div>
          <input placeholder="Onde (ex.: Escritório, Casa)" list="lugares-exp" value={e.local} onChange={(ev) => setE({ ...e, local: ev.target.value })} />
          <datalist id="lugares-exp">{lugares.map((l) => <option key={l.nome} value={l.nome} />)}</datalist>
          <div className="grid2">
            <button className="btn" disabled={!!busy}>{busy ? 'Salvando…' : 'Salvar expediente'}</button>
            {expediente && <button type="button" className="btn ghost" onClick={() => setAberto(false)}>Cancelar</button>}
          </div>
          {erro && <p className="error">{erro}</p>}
        </form>
      )}
    </section>
  )
}

function LugaresCard({ lugares }: { lugares: Lugar[] }) {
  const { busy, erro, salvar } = useSalvar()
  const [lista, setLista] = useState<{ nome: string; endereco: string; min_casa: string }[]>(
    (lugares.length ? lugares : [{ nome: 'Casa', endereco: null, min_casa: null }, { nome: 'Escritório', endereco: null, min_casa: null }, { nome: 'Academia', endereco: null, min_casa: null }])
      .map((l) => ({ nome: l.nome, endereco: l.endereco ?? '', min_casa: l.min_casa == null ? '' : String(l.min_casa) })))
  const mudar = (i: number, k: 'nome' | 'endereco' | 'min_casa', v: string) => setLista(lista.map((l, j) => (j === i ? { ...l, [k]: v } : l)))
  return (
    <details className="card stack" style={{ gap: 10 }} open={!lugares.length}>
      <summary className="row between" style={{ cursor: 'pointer', listStyle: 'none' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Lugares e deslocamento</h2>
        <span className="small muted">{lugares.filter((l) => l.min_casa != null).length} com tempo</span>
      </summary>
      <p className="small muted" style={{ margin: '8px 0' }}>Minutos de casa até cada lugar. A IARA reserva o trajeto antes e depois dos compromissos nesses locais.</p>
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); salvar('l', () => sb().rpc('hub_lugares_salvar', { p: lista })) }}>
        {lista.map((l, i) => (
          <div key={i} className="lugar">
            <input placeholder="Nome" value={l.nome} onChange={(e) => mudar(i, 'nome', e.target.value)} maxLength={40} />
            <input placeholder={l.nome.toLowerCase() === 'casa' ? '—' : 'min'} inputMode="numeric" pattern="[0-9]*" value={l.min_casa} disabled={l.nome.toLowerCase() === 'casa'}
              onChange={(e) => mudar(i, 'min_casa', e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label={`Minutos de casa até ${l.nome}`} />
            <input placeholder="Endereço (opcional)" value={l.endereco} onChange={(e) => mudar(i, 'endereco', e.target.value)} maxLength={200} />
            <button type="button" className="chip" onClick={() => setLista(lista.filter((_, j) => j !== i))} aria-label={`Tirar ${l.nome}`}>✕</button>
          </div>
        ))}
        <div className="grid2">
          <button type="button" className="btn ghost" onClick={() => setLista([...lista, { nome: '', endereco: '', min_casa: '' }])}>+ Lugar</button>
          <button className="btn" disabled={!!busy}>{busy ? 'Salvando…' : 'Salvar lugares'}</button>
        </div>
        {erro && <p className="error">{erro}</p>}
      </form>
    </details>
  )
}

function AgendaCard({ painel }: { painel: Painel }) {
  const router = useRouter()
  const [msg, setMsg] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const feed = painel.feed_token ? `${FUNCTIONS_URL}/iara-agenda?t=${painel.feed_token}` : null
  async function sincronizar() {
    setMsg('Lendo a agenda…')
    try {
      const r = await callFunction<{ ok: boolean; motivo?: string; resultado?: Record<string, number | string>[] }>('iara-agenda', { action: 'sync' })
      setMsg(r.ok ? `Agenda lida: ${Object.entries(r.resultado?.[0] ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nenhum evento'}.` : r.motivo ?? 'Agenda não conectada.')
      router.refresh()
    } catch (e) { setMsg((e as Error).message) }
  }
  const ultima = painel.agenda.ultima_sync ? new Date(painel.agenda.ultima_sync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : null
  return (
    <details className="card stack" style={{ gap: 10 }}>
      <summary className="row between" style={{ cursor: 'pointer', listStyle: 'none' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Agenda (Google / iPhone)</h2>
        <span className="small muted">{ultima ? `${painel.agenda.eventos} eventos · ${ultima}` : 'não conectada'}</span>
      </summary>
      <div className="stack small" style={{ gap: 8, marginTop: 8 }}>
        <p style={{ margin: 0 }}><strong>Da sua agenda para cá</strong> (de hora em hora): os eventos entram como blocos fixos da semana.</p>
        <button className="btn ghost" onClick={sincronizar} disabled={msg === 'Lendo a agenda…'}>Atualizar agenda agora</button>
        {msg && <p className="muted" style={{ margin: 0 }}>{msg}</p>}
        <p style={{ margin: '6px 0 0' }}><strong>Daqui para a sua agenda:</strong> assine este link no iPhone (Ajustes › Calendário › Contas › Adicionar Conta › Outra › Calendário Assinado) ou no Google Agenda (Outras agendas › + › Do URL). Entram os compromissos que você marca aqui e o plano confirmado.</p>
        {feed && (
          <div className="row" style={{ gap: 8 }}>
            <input readOnly value={feed} onFocus={(e) => e.target.select()} aria-label="Link da agenda do IARA HQ" />
            <button className="chip" onClick={() => { navigator.clipboard?.writeText(feed).then(() => setCopiado(true)).catch(() => {}) }}>{copiado ? 'Copiado' : 'Copiar'}</button>
          </div>
        )}
        <p className="muted" style={{ margin: 0 }}>O link é pessoal: quem tiver ele vê esses compromissos.</p>
      </div>
    </details>
  )
}
