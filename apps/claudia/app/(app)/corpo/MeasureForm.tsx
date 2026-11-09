'use client'
import { useActionState, useEffect, useRef } from 'react'
import { addMeasurement, type FormState } from './actions'

const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)

export function MeasureForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(addMeasurement, {})
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (state.ok) ref.current?.reset() }, [state])
  return (
    <form ref={ref} action={action} className="card stack">
      <h2>Medidas (cm)</h2>
      <p className="small muted">Pela manhã, em jejum, fita no umbigo para a cintura e logo abaixo do pomo de adão para o pescoço.</p>
      <div className="grid2">
        <label>Cintura*<input name="waist_cm" inputMode="decimal" required /></label>
        <label>Pescoço<input name="neck_cm" inputMode="decimal" /></label>
        <label>Quadril<input name="hip_cm" inputMode="decimal" /></label>
        <label>Peito<input name="chest_cm" inputMode="decimal" /></label>
        <label>Braço<input name="arm_cm" inputMode="decimal" /></label>
        <label>Coxa<input name="thigh_cm" inputMode="decimal" /></label>
      </div>
      <div className="grid2">
        <label>Data<input name="measured_at" type="date" defaultValue={today()} /></label>
        <label>Nota<input name="note" placeholder="opcional" /></label>
      </div>
      <button className="btn" disabled={pending}>{pending ? 'Salvando…' : 'Salvar medidas'}</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  )
}
