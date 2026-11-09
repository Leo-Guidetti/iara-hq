'use client'
import { useTransition } from 'react'
import { deleteWeight } from './actions'

export function DeleteButton({ id }: { id: number }) {
  const [pending, start] = useTransition()
  return (
    <button
      className="btn ghost small"
      style={{ minHeight: 32, padding: '4px 10px' }}
      disabled={pending}
      onClick={() => { if (confirm('Apagar esta pesagem?')) start(() => deleteWeight(id)) }}
    >
      Apagar
    </button>
  )
}
