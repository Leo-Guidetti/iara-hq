'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type NavItem = { href: string; label: string; icon: string; exact?: boolean }

/** Barra inferior do hub. `icon` é o atributo `d` de um path SVG 24×24 com traço. */
export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname()
  return (
    <nav className="nav" aria-label="Seções">
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((i) => {
          const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`)
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? 'page' : undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={i.icon} />
                </svg>
                {i.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
