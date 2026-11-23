'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavItem = { href: string; label: string; icon: string; exact?: boolean; app?: string; also?: readonly string[] }

/** Barra do hub: só ícones no celular (o nome fica no aria-label/title); no desktop largo o nome aparece ao lado. */
export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  const on = (h: string) => path === h || path.startsWith(`${h}/`)
  return (
    <nav className="nav" aria-label="Áreas">
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((i) => {
          const active = i.exact ? path === i.href : on(i.href) || !!i.also?.some(on)
          return (
            <li key={i.href} data-app={i.app}>
              <Link href={i.href} aria-current={active ? 'page' : undefined} aria-label={i.label} title={i.label}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={i.icon} />
                </svg>
                <span className="rotulo">{i.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
