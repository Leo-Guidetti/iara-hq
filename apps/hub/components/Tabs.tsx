'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Abas de um módulo (ficam no topo da página; a barra de baixo não muda). */
export function Tabs({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname()
  return (
    <nav className="tabs" aria-label="Seções">
      {items.map((i) => {
        const on = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`)
        return <Link key={i.href} href={i.href} aria-current={on ? 'page' : undefined}>{i.label}</Link>
      })}
    </nav>
  )
}
