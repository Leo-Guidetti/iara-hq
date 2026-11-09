'use client'
import { usePathname } from 'next/navigation'
import { Nav, type NavItem } from '@iara/ui'
import { ICON } from '@/lib/icons'

// Site único: o hub (lilás) e um módulo por app, cada um na sua cor.
const HUB: NavItem[] = [
  { href: '/hoje', label: 'Hoje', icon: ICON.hoje, app: 'hq' },
  { href: '/saude', label: 'ClaudIA', icon: ICON.saude, app: 'claudia' },
  { href: '/financas', label: 'AIrton', icon: ICON.financas, app: 'airton' },
  { href: '/casa', label: 'Casa', icon: ICON.casa, app: 'casa' },
  { href: '/perfil', label: 'Perfil', icon: ICON.perfil, app: 'hq' },
]
const CLAUDIA: NavItem[] = [
  { href: '/hoje', label: 'Hub', icon: ICON.hoje, app: 'hq' },
  { href: '/saude', label: 'Resumo', icon: ICON.saude, exact: true },
  { href: '/saude/peso', label: 'Peso', icon: ICON.peso },
  { href: '/saude/corpo', label: 'Corpo', icon: ICON.corpo },
  { href: '/saude/treino', label: 'Treino', icon: ICON.treino },
  { href: '/saude/dieta', label: 'Dieta', icon: ICON.dieta },
]

function appDe(path: string) {
  if (path.startsWith('/saude')) return 'claudia'
  if (path.startsWith('/financas')) return 'airton'
  if (path.startsWith('/casa')) return 'casa'
  return 'hq'
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const app = appDe(path)
  return (
    <div className="app" data-app={app}>
      <main className="shell">{children}</main>
      <Nav items={app === 'claudia' ? CLAUDIA : HUB} />
    </div>
  )
}
