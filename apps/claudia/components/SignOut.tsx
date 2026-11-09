'use client'
import { supabaseBrowser } from '@/lib/supabase/client'

export function SignOut() {
  return (
    <button className="btn ghost" onClick={async () => { await supabaseBrowser().auth.signOut(); location.href = '/login' }}>
      Sair
    </button>
  )
}
