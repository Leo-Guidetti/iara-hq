import Link from 'next/link'
import { currentUser } from '@/lib/supabase/server'
import { addDays, fmtDay, spDate } from '@/lib/dates'
import { FoodEntry, MEAL_PT } from './FoodEntry'
import { DietPlan, type DietRow } from './DietPlan'
import { MedForm } from './MedForm'
import { DeleteFood } from './DeleteFood'

export const dynamic = 'force-dynamic'
const ORDER = ['breakfast', 'lunch', 'snack', 'shake', 'dinner']

function Bar({ label, value, target, unit, kind }: { label: string; value: number; target?: number | null; unit: string; kind: 'ceiling' | 'goal' }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0
  const over = kind === 'ceiling' && target != null && value > target
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row between"><span className="small muted">{label}</span><span className="num">{Math.round(value)}{target ? ` / ${target}` : ''} {unit}</span></div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-2)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: over ? 'var(--alert)' : 'var(--progress)' }} />
      </div>
    </div>
  )
}

export default async function DietaPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  const me = (await currentUser())!
  const today = spDate()
  const { d } = await searchParams
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : today
  const [{ data: foods }, { data: diet }, { data: meds }] = await Promise.all([
    me.sb.from('food_logs').select('id, meal, description, kcal, protein_g, carbs_g, fat_g, source').eq('local_date', date).order('eaten_at'),
    me.sb.from('diet_recommendations').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('medication_logs').select('local_date, drug, dose_mg, side_effects').order('administered_at', { ascending: false }).limit(3),
  ])
  const tot = (foods ?? []).reduce((t, f) => ({ kcal: t.kcal + (f.kcal ?? 0), p: t.p + Number(f.protein_g ?? 0), c: t.c + Number(f.carbs_g ?? 0), g: t.g + Number(f.fat_g ?? 0) }), { kcal: 0, p: 0, c: 0, g: 0 })
  const lastMed = meds?.[0]

  return (
    <div className="stack">
      <div className="row between">
        <h1>Dieta</h1>
        <div className="row">
          <Link className="btn ghost" href={`/dieta?d=${addDays(date, -1)}`} aria-label="dia anterior">‹</Link>
          <span className="num">{date === today ? 'Hoje' : fmtDay(date)}</span>
          {date < today && <Link className="btn ghost" href={`/dieta?d=${addDays(date, 1)}`} aria-label="próximo dia">›</Link>}
        </div>
      </div>

      <section className="card stack">
        <Bar label="Proteína" value={tot.p} target={diet?.protein_g_target} unit="g" kind="goal" />
        <Bar label="Energia" value={tot.kcal} target={diet?.kcal_target} unit="kcal" kind="ceiling" />
        <p className="small muted num">Carboidrato {Math.round(tot.c)} g · gordura {Math.round(tot.g)} g</p>
        {!diet && <p className="small muted">Gere o plano alimentar abaixo para ver as metas.</p>}
      </section>

      <FoodEntry date={date} />

      <section className="card">
        <h2>Refeições</h2>
        {ORDER.filter((m) => foods?.some((f) => f.meal === m)).map((m) => (
          <div key={m} style={{ marginBottom: 10 }}>
            <span className="tag progress">{MEAL_PT[m]}</span>
            <div className="list">
              {foods!.filter((f) => f.meal === m).map((f) => (
                <div key={f.id} className="row between small">
                  <span>{f.description}{f.source === 'ai_estimate' && <span className="tag ai" style={{ marginLeft: 6 }}>✦</span>}</span>
                  <span className="row num muted" style={{ gap: 6, flexShrink: 0 }}>{f.kcal} kcal · {Math.round(Number(f.protein_g ?? 0))} g <DeleteFood id={f.id} /></span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!foods?.length && <p className="muted">Nada registrado neste dia.</p>}
      </section>

      <DietPlan last={diet as DietRow | null} />

      <section className="card">
        <h2>Medicação</h2>
        {lastMed
          ? <p className="small">Última: {fmtDay(lastMed.local_date)} · {lastMed.drug === 'tirzepatide' ? 'tirzepatida' : lastMed.drug} {String(lastMed.dose_mg).replace('.', ',')} mg{lastMed.side_effects?.length ? ` · ${lastMed.side_effects.join(', ')}` : ''}</p>
          : <p className="small muted">Nenhuma aplicação registrada.</p>}
      </section>
      <MedForm lastDose={lastMed ? Number(lastMed.dose_mg) : undefined} />
    </div>
  )
}
