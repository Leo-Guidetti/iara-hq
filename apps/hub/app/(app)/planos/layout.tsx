import { Tabs } from '@/components/Tabs'

const SECOES = [
  { href: '/planos', label: 'Semanas', exact: true },
  { href: '/planos/meses', label: 'Meses' },
  { href: '/planos/metas', label: 'Metas' },
]

export default function PlanosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="stack">
      <Tabs items={SECOES} />
      {children}
    </div>
  )
}
