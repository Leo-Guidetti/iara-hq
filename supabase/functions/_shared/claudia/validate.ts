// Validação mínima sem dependências: lança Error com o caminho do campo inválido.
type Obj = Record<string, unknown>

export function obj(v: unknown, path = 'raiz'): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path}: esperado objeto`)
  return v as Obj
}
export function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${path}: esperado lista`)
  return v
}
export function str(v: unknown, path: string, max = 4000): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${path}: esperado texto`)
  return v.trim().slice(0, max)
}
export function optStr(v: unknown, path: string, max = 4000): string | null {
  return v == null || v === '' ? null : str(v, path, max)
}
export function num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${path}: esperado número`)
  if (n < min || n > max) throw new Error(`${path}: ${n} fora de [${min}, ${max}]`)
  return n
}
export function optNum(v: unknown, path: string, min?: number, max?: number): number | null {
  return v == null || v === '' ? null : num(v, path, min, max)
}
export function oneOf<T extends string>(v: unknown, path: string, opts: readonly T[]): T {
  if (typeof v !== 'string' || !opts.includes(v as T)) throw new Error(`${path}: use um de ${opts.join(', ')}`)
  return v as T
}
export function strList(v: unknown, path: string, maxItems = 20): string[] {
  return arr(v ?? [], path).slice(0, maxItems).map((x, i) => str(x, `${path}[${i}]`, 600))
}
export function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${path}: esperado true/false`)
  return v
}
