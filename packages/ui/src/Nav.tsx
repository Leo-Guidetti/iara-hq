'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export type NavItem = { href: string; label: string; icon: string; exact?: boolean; app?: string; also?: readonly string[]; sub?: string }

/** Barra do hub: só ícones no celular (o nome fica no aria-label/title). No desktop largo vira barra lateral com o logo
 * de cada app, o nome da página e o agente (`sub`); `topo` e `rodape` só aparecem ali. */
export function Nav({ items, topo, rodape }: { items: NavItem[]; topo?: ReactNode; rodape?: ReactNode }) {
  const path = usePathname()
  const on = (h: string) => path === h || path.startsWith(`${h}/`)
  return (
    <nav className="nav" aria-label="Áreas">
      {topo && <div className="nav-topo">{topo}</div>}
      <ul style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((i) => {
          const active = i.exact ? path === i.href : on(i.href) || !!i.also?.some(on)
          return (
            <li key={i.href} data-app={i.app}>
              <Link href={i.href} aria-current={active ? 'page' : undefined} aria-label={i.label} title={i.sub ? `${i.label} · ${i.sub}` : i.label}>
                <span className="nav-ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={i.icon} />
                  </svg>
                </span>
                <span className="rotulo">{i.label}{i.sub && <small>{i.sub}</small>}</span>
              </Link>
            </li>
          )
        })}
      </ul>
      {rodape && <div className="nav-rodape">{rodape}</div>}
    </nav>
  )
}
