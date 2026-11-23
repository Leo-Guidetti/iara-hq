/** Anel de progresso (nota de adesão etc.): número no centro, arco na cor do app. */
export function Anel({ valor, max, tamanho = 84, rotulo }: { valor: number; max: number; tamanho?: number; rotulo: string }) {
  const r = 40, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, valor / max))
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 100 100" role="img" aria-label={rotulo} style={{ flex: 'none' }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="8" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--progress)" strokeWidth="8" strokeLinecap="round"
        strokeDasharray={`${(c * p).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 50 50)" className="anel-arco" />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fill="var(--text)" style={{ fontSize: 28, fontWeight: 300, fontFamily: 'inherit' }}>{valor}</text>
    </svg>
  )
}
