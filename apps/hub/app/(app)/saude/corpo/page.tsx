import { currentUser } from '@/lib/supabase/server'
import { fmtDay, fmtKg } from '@/lib/dates'
import { MeasureForm } from './MeasureForm'
import { CompChart } from './CompChart'
import { PhotoUpload } from './PhotoUpload'
import { PhotoReview, type ReviewRow } from './PhotoReview'

export const dynamic = 'force-dynamic'
const POSE: Record<string, string> = { front: 'Frente', side: 'Perfil', back: 'Costas' }
const f1 = (n: number | null | undefined, unit = '') => (n == null ? '—' : `${Number(n).toFixed(1).replace('.', ',')}${unit}`)

export default async function CorpoPage() {
  const me = (await currentUser())!
  const [{ data: comp }, { data: photos }, { data: review }, { data: profile }] = await Promise.all([
    me.sb.from('body_comp_estimates').select('*').order('local_date'),
    me.sb.from('progress_photos').select('id, local_date, pose, storage_path').order('local_date', { ascending: false }).order('pose'),
    me.sb.from('photo_reviews').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    me.sb.from('profiles').select('height_cm, sex').eq('id', me.user.id).single(),
  ])

  const paths = (photos ?? []).map((p) => p.storage_path)
  const { data: signed } = paths.length
    ? await me.sb.storage.from('progress-photos').createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] }
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
  const byDate = new Map<string, typeof photos>()
  for (const p of photos ?? []) byDate.set(p.local_date, [...(byDate.get(p.local_date) ?? []), p])

  const last = comp?.at(-1)
  const first = comp?.[0]
  const dLean = last && first && last !== first && last.lean_mass_kg != null && first.lean_mass_kg != null ? Number(last.lean_mass_kg) - Number(first.lean_mass_kg) : null
  const dFat = last && first && last !== first && last.fat_mass_kg != null && first.fat_mass_kg != null ? Number(last.fat_mass_kg) - Number(first.fat_mass_kg) : null
  const leanShare = dLean != null && dFat != null && dLean + dFat < 0 ? (dLean / (dLean + dFat)) * 100 : null

  return (
    <div className="stack">
      <div>
        <h1>Corpo</h1>
        <p className="muted small">Fita + peso estimam gordura (RFM e fórmula da Marinha). A pergunta é: o que sai é gordura ou massa magra?</p>
      </div>

      {!profile?.height_cm || !profile?.sex ? (
        <div className="card alert"><span className="tag alert">Falta perfil</span><p>Informe altura e sexo no Perfil para calcular as estimativas.</p></div>
      ) : null}

      <section className="grid2">
        <div className="card">
          <span className="tag progress">Gordura estimada</span>
          <div className="kpi num">{f1(last?.bf_mean, '%')}</div>
          <span className="small muted">RFM {f1(last?.bf_rfm, '%')} · Marinha {f1(last?.bf_navy, '%')}</span>
        </div>
        <div className="card">
          <span className="tag progress">Massa magra</span>
          <div className="kpi num">{fmtKg(last?.lean_mass_kg)}</div>
          <span className="small muted">gordura {fmtKg(last?.fat_mass_kg)} · cintura/altura {last?.waist_height_ratio?.toString().replace('.', ',') ?? '—'}</span>
        </div>
      </section>

      {leanShare != null && (
        <div className={`card ${leanShare > 25 ? 'alert' : ''}`}>
          <span className={`tag ${leanShare > 25 ? 'alert' : 'progress'}`}>Desde {fmtDay(first!.local_date!)}</span>
          <p style={{ margin: '6px 0 0' }}>
            Gordura {dFat! > 0 ? '+' : ''}{f1(dFat, ' kg')} · massa magra {dLean! > 0 ? '+' : ''}{f1(dLean, ' kg')}.{' '}
            {leanShare > 25
              ? `Cerca de ${Math.round(leanShare)}% do que saiu parece massa magra: vale subir proteína e priorizar força.`
              : 'A maior parte do que saiu parece gordura.'}
          </p>
          <p className="small muted" style={{ margin: '6px 0 0' }}>Estimativa por fórmulas: erro de ±3 pontos; olhe a tendência, não um ponto.</p>
        </div>
      )}

      <section className="card"><h2>Gordura x massa magra</h2>
        <CompChart data={(comp ?? []).map((c) => ({ date: c.local_date!, fat: c.fat_mass_kg, lean: c.lean_mass_kg }))} />
      </section>

      <MeasureForm />

      <section className="card">
        <h2>Histórico de medidas</h2>
        <div className="list">
          {[...(comp ?? [])].reverse().map((c) => (
            <div key={c.local_date} className="row between small">
              <span>{fmtDay(c.local_date!)}</span>
              <span className="num muted">cintura {f1(c.waist_cm)} · pescoço {f1(c.neck_cm)}</span>
              <span className="num">{f1(c.bf_mean, '%')}</span>
            </div>
          ))}
          {!comp?.length && <p className="muted">Sem medidas ainda.</p>}
        </div>
      </section>

      <PhotoReview last={review as ReviewRow | null} dates={[...byDate.keys()].sort()} />
      <PhotoUpload userId={me.user.id} />

      {[...byDate.entries()].map(([d, list]) => (
        <section key={d} className="card">
          <h2>{fmtDay(d)}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {list!.map((p) => (
              <figure key={p.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urlOf.get(p.storage_path) ?? undefined} alt={POSE[p.pose]} loading="lazy" style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 10, background: 'var(--surface-2)' }} />
                <figcaption className="small muted" style={{ textAlign: 'center' }}>{POSE[p.pose]}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
