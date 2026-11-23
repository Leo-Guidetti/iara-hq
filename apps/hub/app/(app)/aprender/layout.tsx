import { Tabs } from '@/components/Tabs'

const SECOES = [
  { href: '/aprender', label: 'Trilha', exact: true },
  { href: '/aprender/livros', label: 'Livros' },
  { href: '/aprender/pratica', label: 'Prática' },
]

export default function ConhecimentoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack">
      <Tabs items={SECOES} />
      {children}
    </div>
  )
}
