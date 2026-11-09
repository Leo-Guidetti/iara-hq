'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/', label: 'Início', d: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z' },
  { href: '/peso', label: 'Peso', d: 'M5 20h14l-2-12H7zM9 8a3 3 0 016 0' },
  { href: '/corpo', label: 'Corpo', d: 'M12 4a2 2 0 110 4 2 2 0 010-4zM8 10h8l-1 5h-2l-1 5-1-5H9z' },
  { href: '/treino', label: 'Treino', d: 'M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12' },
  { href: '/dieta', label: 'Dieta', d: 'M7 3v8a3 3 0 006 0V3M10 3v18M17 3c-2 2-2 6 0 8v10' },
  { href: '/perfil', label: 'Perfil', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0' },
]

export function Nav() {
  const path = usePathname()
  return (
    <nav className="nav" aria-label="Seções">
      <ul>
        {ITEMS.map((i) => {
          const active = i.href === '/' ? path === '/' : path.startsWith(i.href)
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={active ? 'page' : undefined}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={i.d} />
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
