export const TZ = 'America/Sao_Paulo'

/** YYYY-MM-DD no fuso de São Paulo. */
export function spDate(d: Date = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: TZ })
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function fmtDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).replace('.', '')
}

export function fmtKg(n: number | null | undefined, digits = 1): string {
  return n == null ? '—' : `${Number(n).toFixed(digits).replace('.', ',')} kg`
}
