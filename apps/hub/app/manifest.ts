import type { MetadataRoute } from 'next'

// PWA: instalável na tela inicial (no iPhone, push só funciona com o app instalado, iOS 16.4+).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'IARA HQ',
    short_name: 'IARA HQ',
    description: 'Central dos assistentes pessoais do Leo.',
    start_url: '/hoje',
    scope: '/',
    display: 'standalone',
    background_color: '#0D1117',
    theme_color: '#0D1117',
    lang: 'pt-BR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
