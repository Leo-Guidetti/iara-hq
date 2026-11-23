'use client'
import { useActionState, useState, useTransition } from 'react'
import { createSiriToken, createToken, revokeToken, saveProfile, type PState } from './actions'

type P = { display_name: string | null; sex: string | null; birth_date: string | null; height_cm: number | null; goal: string | null }

export function ProfileForm({ p }: { p: P }) {
  const [state, action, pending] = useActionState<PState, FormData>(saveProfile, {})
  return (
    <form action={action} className="card stack">
      <h2>Dados pessoais</h2>
      <label>Nome<input name="display_name" defaultValue={p.display_name ?? ''} /></label>
      <div className="grid2">
        <label>Sexo<select name="sex" defaultValue={p.sex ?? ''}><option value="">—</option><option value="male">masculino</option><option value="female">feminino</option></select></label>
        <label>Altura (cm)<input name="height_cm" inputMode="decimal" defaultValue={p.height_cm ?? ''} /></label>
      </div>
      <label>Nascimento<input name="birth_date" type="date" defaultValue={p.birth_date ?? ''} /></label>
      <label>Objetivo<input name="goal" defaultValue={p.goal ?? ''} /></label>
      <button className="btn" disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</button>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="small" style={{ color: 'var(--progress)' }}>Salvo.</p>}
    </form>
  )
}

export function Tokens({ tokens, endpoint }: { tokens: { id: number; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }[]; endpoint: string }) {
  const [label, setLabel] = useState('iPhone')
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const active = tokens.filter((t) => !t.revoked_at)
  return (
    <section className="card stack">
      <h2>Atalho do iPhone</h2>
      <p className="small muted">O Atalho envia peso e dados do Apple Watch para a ClaudIA com um token só seu. O token aparece uma vez: guarde-o no Atalho.</p>
      {fresh && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <span className="tag progress">Token novo</span>
          <code style={{ wordBreak: 'break-all', display: 'block', margin: '6px 0' }}>{fresh}</code>
          <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(fresh)}>Copiar</button>
        </div>
      )}
      <div className="row"><input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Nome do token" />
        <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await createToken(label); if (r.error) setError(r.error); else setFresh(r.token!) })}>Criar</button></div>
      <div className="list small">
        {active.map((t) => (
          <div key={t.id} className="row between"><span>{t.label}<br /><span className="muted">usado {t.last_used_at ? new Date(t.last_used_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}</span></span>
            <button className="btn ghost" style={{ minHeight: 32 }} disabled={pending} onClick={() => { if (confirm('Revogar este token? O Atalho que o usa para de funcionar.')) start(() => revokeToken(t.id)) }}>Revogar</button></div>
        ))}
        {!active.length && <p className="muted">Nenhum token ativo.</p>}
      </div>
      <details className="small">
        <summary className="muted">Como montar o Atalho</summary>
        <ol style={{ paddingLeft: 18 }}>
          <li>Ação <em>Obter Conteúdo do URL</em> → URL <code style={{ wordBreak: 'break-all' }}>{endpoint}</code>, método POST.</li>
          <li>Cabeçalho <code>Authorization</code> = <code>Bearer cla_…</code> (o token acima).</li>
          <li>Corpo JSON. Peso: <code>{'{"weight_kg": 82.4}'}</code>. Saúde do dia: <code>{'{"steps": 9000, "sleep_h": 7.2, "active_kcal": 450, "resting_hr": 58, "hrv_ms": 42}'}</code>.</li>
          <li>Use as ações do app Saúde para ler os valores e uma automação diária (ex.: 22h) para enviar.</li>
        </ol>
      </details>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

type SiriTok = { id: number; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

export function SiriToken({ tokens, url }: { tokens: SiriTok[]; url: string }) {
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const active = tokens.filter((t) => !t.revoked_at)
  const copy = (key: string, text: string) => { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 1500) }
  const header = `Bearer ${fresh ?? 'iar_••••••••••••••••••••••••'}`
  return (
    <section className="card stack">
      <h2>Falar com a IARA pela Siri</h2>
      <p className="small muted">Com um Atalho chamado <strong>IARA</strong>, você diz &ldquo;Hey Siri, IARA&rdquo; no iPhone, no Apple Watch ou no AirPods e a IARA responde em voz alta. Resposta longa ou demorada chega por push, dentro do seu limite de avisos do dia. O token só vale para a IARA e aparece uma vez.</p>
      {fresh && (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <span className="tag progress">Token novo</span>
          <code style={{ wordBreak: 'break-all', display: 'block', margin: '6px 0' }}>{fresh}</code>
          <p className="small muted">Guarde agora; não aparece de novo.</p>
          <button className="btn ghost" onClick={() => copy('tok', fresh)}>{copied === 'tok' ? 'Copiado' : 'Copiar'}</button>
        </div>
      )}
      <div><button className="btn" disabled={pending} onClick={() => { setError(null); start(async () => { const r = await createSiriToken(); if (r.error) setError(r.error); else setFresh(r.token!) }) }}>{pending ? 'Criando…' : 'Criar token da Siri'}</button></div>
      {error && <p className="error">{error}</p>}
      <div className="list small">
        {active.map((t) => (
          <div key={t.id} className="row between">
            <span>{t.label} <span className="tag">IARA</span><br /><span className="muted">usado {t.last_used_at ? new Date(t.last_used_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca'}</span></span>
            {confirmId === t.id ? (
              <span className="row">
                <button className="btn ghost" style={{ minHeight: 32 }} disabled={pending} onClick={() => setConfirmId(null)}>Cancelar</button>
                <button className="btn" style={{ minHeight: 32 }} disabled={pending} onClick={() => start(async () => { await revokeToken(t.id); setConfirmId(null) })}>Revogar mesmo</button>
              </span>
            ) : (
              <button className="btn ghost" style={{ minHeight: 32 }} disabled={pending} onClick={() => setConfirmId(t.id)}>Revogar</button>
            )}
          </div>
        ))}
        {!active.length && <p className="muted">Nenhum token da Siri ativo.</p>}
      </div>
      {confirmId != null && <p className="small muted">O Atalho que usa este token para de funcionar.</p>}
      <h3 style={{ margin: 0 }}>Passo a passo do Atalho (iPhone em inglês)</h3>
      <ol className="small" style={{ paddingLeft: 18 }}>
        <li>No app <em>Shortcuts</em>, toque em <em>+</em> e dê ao atalho o nome <strong>IARA</strong> (curto e igual ao que você vai falar). Se já tem o &ldquo;Falar com a IARA&rdquo;, só renomeie.</li>
        <li>Adicione a ação <em>Dictate Text</em> e ajuste <em>Language</em> = <strong>Portuguese (Brazil)</strong> e <em>Stop Listening</em> = <em>After Pause</em>.</li>
        <li>Adicione <em>Get Contents of URL</em> e toque em <em>Show More</em>:
          <div className="stack" style={{ gap: 6, margin: '6px 0' }}>
            <div>URL <code style={{ wordBreak: 'break-all' }}>{url}</code> <button className="btn ghost" style={{ minHeight: 28 }} onClick={() => copy('url', url)}>{copied === 'url' ? 'Copiado' : 'Copiar'}</button></div>
            <div><em>Method</em> <code>POST</code></div>
            <div><em>Headers</em>: <code>Authorization</code> = <code style={{ wordBreak: 'break-all' }}>{header}</code> <button className="btn ghost" style={{ minHeight: 28 }} onClick={() => copy('hdr', header)}>{copied === 'hdr' ? 'Copiado' : 'Copiar'}</button>
              {!fresh && <span className="muted"> (troque pelo seu token iar_; o completo só aparece ao criar)</span>}</div>
            <div><em>Request Body</em> = <em>JSON</em>: <code>texto</code> (Text) = <em>Dictated Text</em> e <code>canal</code> (Text) = <code>atalho</code></div>
          </div>
        </li>
        <li>Adicione <em>Speak Text</em> com <em>Contents of URL</em>; em <em>Show More</em>, <em>Language</em> = <strong>Portuguese (Brazil)</strong>.</li>
        <li>Apple Watch: nos detalhes do atalho (ícone <em>i</em>), ligue <em>Show on Apple Watch</em>.</li>
        <li>Botão de ação (iPhone 15 Pro ou mais novo): <em>Settings → Action Button → Shortcut → IARA</em>.</li>
        <li>Para ouvir o push no AirPods: <em>Settings → Notifications → Announce Notifications</em>, ligado para o app do hub.</li>
        <li>Se a IARA pedir confirmação, rode o atalho de novo e diga &ldquo;sim&rdquo;.</li>
      </ol>
      <p className="small muted">Depois é só dizer &ldquo;Hey Siri, IARA&rdquo; e falar o pedido quando ela começar a ouvir. Com a Siri em inglês, se &ldquo;IARA&rdquo; não for reconhecido de primeira, fale devagar ou teste outro nome curto para o atalho.</p>
    </section>
  )
}
