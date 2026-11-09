'use client'
import { useActionState, useState, useTransition } from 'react'
import { createToken, revokeToken, saveProfile, type PState } from './actions'

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
