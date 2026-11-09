'use client'
import { useActionState, useEffect, useRef } from 'react'
import { addWeight, type FormState } from './actions'

function nowLocal() {
  const d = new Date(Date.now() - 3 * 3600_000)
  return d.toISOString().slice(0, 16)
}

export function WeightForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addWeight, {})
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) ref.current?.reset() }, [state])

  return (
    <form ref={ref} action={action} className="card stack">
      <h2>Registrar</h2>
      <div className="grid2">
        <label>Peso (kg)<input name="weight_kg" inputMode="decimal" placeholder="82,4" required /></label>
        <label>Quando<input name="measured_at" type="datetime-local" defaultValue={nowLocal()} /></label>
      </div>
      <label className="row" style={{ color: 'var(--text)' }}>
        <input name="fasted" type="checkbox" defaultChecked style={{ width: 20, height: 20 }} /> Em jejum, após o banheiro
      </label>
      <label>Nota<input name="note" placeholder="opcional" /></label>
      <button className="btn" disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  )
}
