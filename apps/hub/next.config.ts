import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@iara/ui'],
  // Voltar a uma aba vista há menos de 30 s não refaz a busca; as ações já chamam router.refresh().
  experimental: { staleTimes: { dynamic: 30 } },
}

export default config
