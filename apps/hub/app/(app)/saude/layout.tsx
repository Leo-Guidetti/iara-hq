import { Tabs } from '@/components/Tabs'

const SECOES = [
  { href: '/saude', label: 'Resumo', exact: true },
  { href: '/saude/peso', label: 'Peso' },
  { href: '/saude/corpo', label: 'Corpo' },
  { href: '/saude/treino', label: 'Treino' },
  { href: '/saude/dieta', label: 'Dieta' },
]

export default function SaudeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack">
      <Tabs items={SECOES} />
      {children}
    </div>
  )
}
