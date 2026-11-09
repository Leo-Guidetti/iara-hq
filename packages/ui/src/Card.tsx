import type { ReactNode } from 'react'

/** Cartão de KPI: selo, número grande e legenda. `tone` segue os tokens: progress, alert ou ai. */
export function Kpi({ label, value, caption, tone = 'progress' }: { label: string; value: ReactNode; caption?: ReactNode; tone?: 'progress' | 'alert' | 'ai' }) {
  return (
    <div className={`card ${tone === 'progress' ? '' : tone}`}>
      <span className={`tag ${tone}`}>{label}</span>
      <div className="kpi num">{value}</div>
      {caption && <span className="small muted">{caption}</span>}
    </div>
  )
}
