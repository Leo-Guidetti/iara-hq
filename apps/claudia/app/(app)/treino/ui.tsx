export const SPORT_PT: Record<string, string> = {
  run: 'Corrida', walk: 'Caminhada', hike: 'Trilha', swim: 'Natação', ride_indoor: 'Bike indoor', ride_outdoor: 'Bike', strength: 'Força',
  hiit: 'HIIT', yoga: 'Yoga', mobility: 'Mobilidade', row: 'Remo', other: 'Outro',
}
export const INTENSITY_PT: Record<string, string> = {
  recovery: 'recuperação', easy: 'leve', moderate: 'moderado', tempo: 'tempo', threshold: 'limiar', intervals: 'intervalado', long: 'longo', strength: 'força',
}
export function StatusChip({ status }: { status: string }) {
  if (status === 'done') return <span className="tag progress">✓ feito</span>
  if (status === 'skipped') return <span className="tag alert">pulado</span>
  return <span className="tag" style={{ color: 'var(--muted)' }}>planejado</span>
}
