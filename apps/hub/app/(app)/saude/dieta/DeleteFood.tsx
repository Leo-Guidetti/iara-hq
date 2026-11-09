'use client'
import { useTransition } from 'react'
import { deleteFood } from './actions'

export function DeleteFood({ id }: { id: number }) {
  const [pending, start] = useTransition()
  return <button className="btn ghost small" style={{ minHeight: 30, padding: '2px 10px' }} disabled={pending} onClick={() => start(() => deleteFood(id))}>×</button>
}
