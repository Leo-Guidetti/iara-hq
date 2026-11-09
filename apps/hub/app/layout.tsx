import type { Metadata, Viewport } from 'next'
import '@iara/ui/styles.css'

export const metadata: Metadata = {
  title: 'IARA HQ',
  description: 'Central dos assistentes pessoais do Leo.',
  appleWebApp: { capable: true, title: 'IARA HQ', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0D1117' },
    { media: '(prefers-color-scheme: light)', color: '#F5F6F8' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// Aplica o tema salvo antes da primeira pintura (sem piscar).
const TEMA = "try{var t=localStorage.getItem('tema');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}"

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEMA }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Semi+Condensed:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
