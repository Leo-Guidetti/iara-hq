// Validação mínima sem dependências: lança Error com o caminho do campo inválido.
export function obj(v, path = 'raiz') {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path}: esperado objeto`);
  return v;
}
export function arr(v, path) {
  if (!Array.isArray(v)) throw new Error(`${path}: esperado lista`);
  return v;
}
export function str(v, path, max = 4000) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${path}: esperado texto`);
  return v.trim().slice(0, max);
}
export function optStr(v, path, max = 4000) {
  return v == null || v === '' ? null : str(v, path, max);
}
export function num(v, path, min = -Infinity, max = Infinity) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${path}: esperado número`);
  if (n < min || n > max) throw new Error(`${path}: ${n} fora de [${min}, ${max}]`);
  return n;
}
export function optNum(v, path, min, max) {
  return v == null || v === '' ? null : num(v, path, min, max);
}
export function oneOf(v, path, opts) {
  if (typeof v !== 'string' || !opts.includes(v)) throw new Error(`${path}: use um de ${opts.join(', ')}`);
  return v;
}
export function strList(v, path, maxItems = 20) {
  return arr(v ?? [], path).slice(0, maxItems).map((x, i)=>str(x, `${path}[${i}]`, 600));
}
export function bool(v, path) {
  if (typeof v !== 'boolean') throw new Error(`${path}: esperado true/false`);
  return v;
}
