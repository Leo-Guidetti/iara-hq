'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { callFunction } from '@/lib/functions'
import { saveFoods, type FoodItem } from './actions'

export const MEAL_PT: Record<string, string> = { breakfast: 'Café da manhã', lunch: 'Almoço', snack: 'Lanche', shake: 'Shake', dinner: 'Jantar' }

export function FoodEntry({ date }: { date: string }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [meal, setMeal] = useState('')
  const [items, setItems] = useState<FoodItem[] | null>(null)
  const [source, setSource] = useState<'manual' | 'ai_estimate'>('ai_estimate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function parse() {
    setBusy(true); setError(null)
    try {
      const r = await callFunction<{ items: FoodItem[] }>('claudia-food-parse', { text, meal: meal || undefined, date })
      setItems(r.items); setSource('ai_estimate')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  function manual() {
    setItems([{ description: text || '', meal: meal || 'snack', kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }]); setSource('manual')
  }
  async function save() {
    setBusy(true); setError(null)
    const r = await saveFoods(items ?? [], date, source)
    setBusy(false)
    if (r.error) return setError(r.error)
    setItems(null); setText(''); router.refresh()
  }
  const set = (i: number, k: keyof FoodItem, v: string) =>
    setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, [k]: k === 'description' || k === 'meal' ? v : Number(v.replace(',', '.')) || 0 } : x)))

  if (items) {
    const tot = items.reduce((t, i) => ({ kcal: t.kcal + i.kcal, p: t.p + i.protein_g }), { kcal: 0, p: 0 })
    return (
      <section className={`card stack ${source === 'ai_estimate' ? 'ai' : ''}`}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Confirme os itens</h2>
          {source === 'ai_estimate' && <span className="tag ai">✦ estimativa da IA</span>}
        </div>
        {items.map((it, i) => (
          <div key={i} className="stack" style={{ gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <input value={it.description} onChange={(e) => set(i, 'description', e.target.value)} placeholder="Descrição" />
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 6 }}>
              <select value={it.meal} onChange={(e) => set(i, 'meal', e.target.value)}>{Object.entries(MEAL_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <input aria-label="kcal" inputMode="numeric" value={it.kcal} onChange={(e) => set(i, 'kcal', e.target.value)} />
              <input aria-label="proteína" inputMode="decimal" value={it.protein_g} onChange={(e) => set(i, 'protein_g', e.target.value)} />
              <input aria-label="carboidrato" inputMode="decimal" value={it.carbs_g} onChange={(e) => set(i, 'carbs_g', e.target.value)} />
              <input aria-label="gordura" inputMode="decimal" value={it.fat_g} onChange={(e) => set(i, 'fat_g', e.target.value)} />
            </div>
            <div className="row between small muted"><span>kcal · prot · carb · gord (g)</span>
              <button className="btn ghost" style={{ minHeight: 30, padding: '2px 10px' }} onClick={() => setItems((xs) => xs!.filter((_, j) => j !== i))}>remover</button></div>
          </div>
        ))}
        <p className="num">Total: {tot.kcal} kcal · {Math.round(tot.p)} g proteína</p>
        <div className="grid2">
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
          <button className="btn ghost" onClick={() => setItems(null)}>Cancelar</button>
        </div>
        {source === 'ai_estimate' && <p className="disclaimer">Estimativa de porções e macros; confira e ajuste antes de salvar.</p>}
        {error && <p className="error">{error}</p>}
      </section>
    )
  }

  return (
    <section className="card stack">
      <h2>Registrar refeição</h2>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: 2 ovos mexidos, 1 pão francês e café com leite" />
      <label>Refeição<select value={meal} onChange={(e) => setMeal(e.target.value)}>
        <option value="">deduzir pelo texto</option>{Object.entries(MEAL_PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></label>
      <div className="grid2">
        <button className="btn ai" onClick={parse} disabled={busy || !text.trim()}>{busy ? 'Calculando…' : '✦ Estimar com IA'}</button>
        <button className="btn ghost" onClick={manual}>Digitar macros</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}
