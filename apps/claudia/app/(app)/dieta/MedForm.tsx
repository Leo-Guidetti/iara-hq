'use client'
import { useActionState } from 'react'
import { addMedication, type MedState } from './actions'

const now = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 16)

export function MedForm({ lastDose }: { lastDose?: number }) {
  const [state, action, pending] = useActionState<MedState, FormData>(addMedication, {})
  return (
    <details className="card">
      <summary><strong>Registrar aplicação</strong></summary>
      <form action={action} className="stack" style={{ marginTop: 12 }}>
        <div className="grid2">
          <label>Medicamento<select name="drug" defaultValue="tirzepatide"><option value="tirzepatide">Tirzepatida</option><option value="semaglutide">Semaglutida</option><option value="other">Outro</option></select></label>
          <label>Dose (mg)<input name="dose_mg" inputMode="decimal" defaultValue={lastDose ?? ''} required /></label>
          <label>Local<select name="injection_site" defaultValue="abdomen"><option value="abdomen">Abdômen</option><option value="thigh">Coxa</option><option value="arm">Braço</option></select></label>
          <label>Quando<input name="administered_at" type="datetime-local" defaultValue={now()} /></label>
        </div>
        <label>Efeitos colaterais (separados por vírgula)<input name="side_effects" placeholder="náusea, constipação" /></label>
        <label>Nota<input name="note" /></label>
        <button className="btn" disabled={pending}>Salvar</button>
        {state.error && <p className="error">{state.error}</p>}
        {state.ok && <p className="small" style={{ color: 'var(--progress)' }}>Registrado.</p>}
        <p className="small muted">Só registro. Dose e ajustes são decisão do seu médico.</p>
      </form>
    </details>
  )
}
