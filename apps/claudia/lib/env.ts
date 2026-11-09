// Valores públicos por definição (URL do projeto e publishable key, protegida por RLS).
// As variáveis de ambiente têm prioridade; o padrão evita depender delas no Vercel.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wrtrhdrohabspbaxpbeu.supabase.co'
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_wCVY73rR8IKR33J3l8UdCA_uchnjYfl'
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`
