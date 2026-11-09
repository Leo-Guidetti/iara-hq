'use client'
import { usePathname } from 'next/navigation'
import { Nav, type NavItem } from '@iara/ui'

const I = {
  hoje: 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6',
  saude: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  peso: 'M5 20h14l-2-12H7zM9 8a3 3 0 016 0',
  corpo: 'M12 4a2 2 0 110 4 2 2 0 010-4zM8 10h8l-1 5h-2l-1 5-1-5H9z',
  treino: 'M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12',
  dieta: 'M7 3v8a3 3 0 006 0V3M10 3v18M17 3c-2 2-2 6 0 8v10',
  perfil: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
}

// Hub (lilás): a tela Hoje é o menu; cada app tem a sua cor e as suas abas.
const HUB: NavItem[] = [
  { href: '/hoje', label: 'Hoje', icon: I.hoje },
  { href: '/saude', label: 'ClaudIA', icon: I.saude },
  { href: '/perfil', label: 'Perfil', icon: I.perfil },
]
const CLAUDIA: NavItem[] = [
  { href: '/hoje', label: 'Hub', icon: I.hoje },
  { href: '/saude', label: 'Resumo', icon: I.saude, exact: true },
  { href: '/saude/peso', label: 'Peso', icon: I.peso },
  { href: '/saude/corpo', label: 'Corpo', icon: I.corpo },
  { href: '/saude/treino', label: 'Treino', icon: I.treino },
  { href: '/saude/dieta', label: 'Dieta', icon: I.dieta },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const app = path.startsWith('/saude') ? 'claudia' : 'hq'
  return (
    <div className="app" data-app={app}>
      <main className="shell">{children}</main>
      <Nav items={app === 'claudia' ? CLAUDIA : HUB} />
    </div>
  )
}
