'use client'
import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction } from '@/lib/functions'
import { AiCard } from '@/components/AiCard'
import { deleteSet, logSet, moveSession, setStatus, type SetState } from '../actions'

export function SessionActions({ id, status, date }: { id: number; status: string; date: string }) {
  const [pending, start] = useTransition()
  const [d, setD] = useState(date)
  return (
    <section className="card stack">
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <button className="btn" disabled={pending || status === 'done'} onClick={() => start(async () => { await setStatus(id, 'done') })}>Feito</button>
        <button className="btn ghost" disabled={pending || status === 'skipped'} onClick={() => start(async () => { await setStatus(id, 'skipped') })}>Pular</button>
        <button className="btn ghost" disabled={pending || status === 'planned'} onClick={() => start(async () => { await setStatus(id, 'planned') })}>Reabrir</button>
      </div>
      <div className="row"><input type="date" value={d} onChange={(e) => setD(e.target.value)} /><button className="btn ghost" disabled={pending || d === date} onClick={() => start(async () => { await moveSession(id, d) })}>Mover</button></div>
    </section>
  )
}

export function SetLogger({ sessionId, exercises, counts }: { sessionId: number; exercises: string[]; counts: Record<string, number> }) {
  const [state, action, pending] = useActionState<SetState, FormData>(logSet, {})
  const [ex, setEx] = useState(exercises[0] ?? '')
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) { ref.current?.querySelector<HTMLInputElement>('[name=reps]')?.focus() } }, [state])
  return (
    <form ref={ref} action={action} className="card stack">
      <h2>Registrar série</h2>
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="set_number" value={(counts[ex] ?? 0) + 1} />
      {exercises.length ? (
        <label>Exercício<select name="exercise" value={ex} onChange={(e) => setEx(e.target.value)}>{exercises.map((e) => <option key={e}>{e}</option>)}</select></label>
      ) : <label>Exercício<input name="exercise" value={ex} onChange={(e) => setEx(e.target.value)} /></label>}
      <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <label>Carga (kg)<input name="load_kg" inputMode="decimal" /></label>
        <label>Reps<input name="reps" inputMode="numeric" /></label>
        <label>RPE<input name="rpe" inputMode="decimal" placeholder="1–10" /></label>
      </div>
      <button className="btn" disabled={pending}>{pending ? 'Salvando…' : `Salvar série ${(counts[ex] ?? 0) + 1}`}</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  )
}

export function DeleteSet({ id, sessionId }: { id: number; sessionId: number }) {
  const [pending, start] = useTransition()
  return <button className="btn ghost" style={{ minHeight: 28, padding: '0 8px' }} disabled={pending} onClick={() => start(() => deleteSet(id, sessionId))}>×</button>
}

type Change = { summary: string; patch: Record<string, unknown> }
type Msg = { role: 'user' | 'assistant'; content: string; change?: Change | null; applied?: boolean }

export function SessionChat({ sessionId }: { sessionId: number }) {
  const router = useRouter()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    const message = text.trim()
    if (!message) return
    setBusy(true); setError(null); setText('')
    const history = msgs.map(({ role, content }) => ({ role, content }))
    setMsgs((m) => [...m, { role: 'user', content: message }])
    try {
      const r = await callFunction<{ reply: string; change: Change | null }>('claudia-coach-session', { action: 'chat', session_id: sessionId, message, history })
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply, change: r.change }])
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function apply(i: number) {
    setBusy(true); setError(null)
    try {
      await callFunction('claudia-coach-session', { action: 'apply', session_id: sessionId, change: msgs[i].change })
      setMsgs((m) => m.map((x, j) => (j === i ? { ...x, applied: true } : x)))
      router.refresh()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <AiCard title="Conversar sobre esta sessão">
      <div className="stack" style={{ gap: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ justifySelf: m.role === 'user' ? 'end' : 'start', maxWidth: '90%' }}>
            <div className="card" style={{ background: m.role === 'user' ? 'var(--surface-2)' : 'color-mix(in srgb, var(--ai) 14%, var(--surface))', padding: 10 }}>{m.content}</div>
            {m.change && (
              <div className="row small" style={{ marginTop: 6 }}>
                <span className="muted">{m.change.summary}</span>
                {m.applied ? <span className="tag progress">✓ aplicado</span> : <button className="btn ai" style={{ minHeight: 32, padding: '4px 10px' }} disabled={busy} onClick={() => apply(i)}>Aplicar</button>}
              </div>
            )}
          </div>
        ))}
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: hoje estou com 30 min, ou dói o ombro no supino" />
        <button className="btn ai" onClick={send} disabled={busy || !text.trim()}>{busy ? 'Pensando…' : 'Enviar'}</button>
        {error && <p className="error">{error}</p>}
      </div>
    </AiCard>
  )
}
