'use client'
import { useActionState } from 'react'
import { saveTrainingProfile, type ProfState } from '../actions'
import { SPORT_PT } from '../ui'

const SPORTS = ['strength', 'run', 'walk', 'swim', 'ride_indoor', 'ride_outdoor', 'hiit', 'yoga', 'mobility', 'row']
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']
type TP = { goal: string | null; sports: unknown; weekdays: number[]; session_minutes: number; equipment: string; limitations: string | null; coach_notes: string | null; hr_max: number | null; hr_rest: number | null; ftp_w: number | null; run_threshold_s_km: number | null; swim_css_s_100: number | null } | null

export function TrainingProfileForm({ tp }: { tp: TP }) {
  const [state, action, pending] = useActionState<ProfState, FormData>(saveTrainingProfile, {})
  const sports = new Map(((tp?.sports as { sport: string; level: string }[]) ?? []).map((s) => [s.sport, s.level]))
  return (
    <form action={action} className="stack">
      <section className="card stack">
        <label>Objetivo<input name="goal" defaultValue={tp?.goal ?? 'perder gordura mantendo força e ganhar condicionamento'} /></label>
        <h2>Esportes e nível</h2>
        <div className="list">
          {SPORTS.map((s) => (
            <div key={s} className="row between">
              <label className="row" style={{ color: 'var(--text)' }}><input type="checkbox" name={`sport_${s}`} defaultChecked={sports.has(s)} style={{ width: 20, height: 20 }} />{SPORT_PT[s]}</label>
              <select name={`level_${s}`} defaultValue={sports.get(s) ?? 'beginner'} style={{ width: 150 }}><option value="beginner">iniciante</option><option value="intermediate">intermediário</option><option value="advanced">avançado</option></select>
            </div>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h2>Disponibilidade</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {WD.map((d, i) => <label key={d} className="row" style={{ color: 'var(--text)', gap: 4 }}><input type="checkbox" name={`wd_${i}`} defaultChecked={tp ? tp.weekdays.includes(i) : i < 5} style={{ width: 20, height: 20 }} />{d}</label>)}
        </div>
        <div className="grid2">
          <label>Minutos por sessão<input name="session_minutes" inputMode="numeric" defaultValue={tp?.session_minutes ?? 45} /></label>
          <label>Equipamento<select name="equipment" defaultValue={tp?.equipment ?? 'gym'}><option value="gym">academia</option><option value="home_dumbbells">halteres em casa</option><option value="bodyweight">peso do corpo</option></select></label>
        </div>
        <label>Limitações e lesões<textarea name="limitations" rows={2} defaultValue={tp?.limitations ?? ''} /></label>
        <label>Notas para o coach<textarea name="coach_notes" rows={2} defaultValue={tp?.coach_notes ?? ''} /></label>
      </section>
      <section className="card stack">
        <h2>Métricas (opcional)</h2>
        <div className="grid2">
          <label>FC máx<input name="hr_max" inputMode="numeric" defaultValue={tp?.hr_max ?? ''} /></label>
          <label>FC repouso<input name="hr_rest" inputMode="numeric" defaultValue={tp?.hr_rest ?? ''} /></label>
          <label>FTP (W)<input name="ftp_w" inputMode="numeric" defaultValue={tp?.ftp_w ?? ''} /></label>
          <label>Limiar corrida (s/km)<input name="run_threshold_s_km" inputMode="numeric" defaultValue={tp?.run_threshold_s_km ?? ''} /></label>
          <label>CSS natação (s/100 m)<input name="swim_css_s_100" inputMode="numeric" defaultValue={tp?.swim_css_s_100 ?? ''} /></label>
        </div>
      </section>
      <button className="btn" disabled={pending}>{pending ? 'Salvando…' : 'Salvar perfil'}</button>
      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p className="small" style={{ color: 'var(--progress)' }}>Salvo.</p>}
    </form>
  )
}
