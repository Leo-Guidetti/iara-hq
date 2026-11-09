'use server'
import { revalidatePath } from 'next/cache'
import { currentUser } from '@/lib/supabase/server'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'shake']
export type FoodItem = { description: string; meal: string; protein_g: number; kcal: number; carbs_g: number; fat_g: number }

const clean = (n: unknown) => { const x = Number(n); return Number.isFinite(x) && x >= 0 ? x : 0 }

/** Grava itens confirmados. `source` = 'ai_estimate' quando vieram da claudia-food-parse. */
export async function saveFoods(items: FoodItem[], date: string, source: 'manual' | 'ai_estimate') {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Data inválida.' }
  const rows = items.filter((i) => i.description?.trim()).slice(0, 30).map((i) => {
    const meal = MEALS.includes(i.meal) ? i.meal : 'snack'
    const hour = { breakfast: '08:00', lunch: '12:30', snack: '16:00', shake: '16:00', dinner: '20:00' }[meal]
    const eaten = new Date(`${date}T${hour}:00-03:00`)
    return {
      user_id: me.user.id, description: i.description.trim().slice(0, 200), meal, source,
      eaten_at: eaten.toISOString(), local_date: date,
      kcal: Math.round(clean(i.kcal)), protein_g: clean(i.protein_g), carbs_g: clean(i.carbs_g), fat_g: clean(i.fat_g),
    }
  })
  if (!rows.length) return { error: 'Nada para salvar.' }
  const { error } = await me.sb.from('food_logs').insert(rows)
  if (error) return { error: error.message }
  revalidatePath('/dieta'); revalidatePath('/')
  return { ok: true }
}

export async function deleteFood(id: number) {
  const me = await currentUser()
  if (!me) return
  await me.sb.from('food_logs').delete().eq('id', id).eq('user_id', me.user.id)
  revalidatePath('/dieta'); revalidatePath('/')
}

export type MedState = { error?: string; ok?: boolean }
export async function addMedication(_: MedState, form: FormData): Promise<MedState> {
  const me = await currentUser()
  if (!me) return { error: 'Sessão expirada.' }
  const dose = Number(String(form.get('dose_mg') ?? '').replace(',', '.'))
  if (!(dose > 0 && dose <= 20)) return { error: 'Dose entre 0 e 20 mg.' }
  const drug = String(form.get('drug'))
  const site = String(form.get('injection_site') ?? '') || null
  const when = String(form.get('administered_at') ?? '')
  const at = when ? new Date(`${when}:00-03:00`) : new Date()
  const effects = String(form.get('side_effects') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10)
  const { error } = await me.sb.from('medication_logs').insert({
    user_id: me.user.id, drug, dose_mg: dose, injection_site: site, administered_at: at.toISOString(),
    local_date: at.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }),
    side_effects: effects.length ? effects : null, note: String(form.get('note') ?? '').trim().slice(0, 500) || null,
  })
  if (error) return { error: error.message }
  revalidatePath('/dieta')
  return { ok: true }
}
