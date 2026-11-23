import Link from 'next/link'

// iPad e desktop: alterna entre o Hub da casa (/central, tela de parede) e a Gestão (o app de sempre). Só ícones, no canto
// superior direito; no iPhone some (styles.css).
export function ModoTela({ atual }: { atual: 'casa' | 'gestao' }) {
  return (
    <span className="modo-tela" role="radiogroup" aria-label="Modo da tela">
      <Link href="/central" role="radio" aria-checked={atual === 'casa'} aria-label="Hub da casa" title="Hub da casa">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M11 18h2" /></svg>
      </Link>
      <Link href="/hoje" role="radio" aria-checked={atual === 'gestao'} aria-label="Gestão" title="Gestão">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      </Link>
    </span>
  )
}
