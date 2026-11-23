'use client'
import { useEffect, useState } from 'react'

// Relógio com o arco do sol (Hub da casa do iPad, protótipo de 23/11). Nascer e pôr do sol calculados para São Paulo
// (fórmula da NOAA, sem rede); o sol anda no arco conforme a hora. A curva é um cosseno de 24 h centrado no meio-dia solar,
// e o horizonte é a altura da curva no nascer/pôr: acima dele o arco é dourado, abaixo, tracejado.
const LAT = -23.55, LON = -46.63, FUSO = -3
const W = 1000, H = 230, TOPO = 20, BASE = 240

function solDoDia(d: Date) {
  const ini = Date.UTC(d.getUTCFullYear(), 0, 0)
  const n = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ini) / 864e5)
  const g = (2 * Math.PI / 365) * (n - 1)
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g))
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)
  const rad = (x: number) => (x * Math.PI) / 180
  const ha = (Math.acos(Math.cos(rad(90.833)) / (Math.cos(rad(LAT)) * Math.cos(dec)) - Math.tan(rad(LAT)) * Math.tan(dec)) * 180) / Math.PI
  const nascer = (720 - 4 * (LON + ha) - eq + FUSO * 60) / 60
  const por = (720 - 4 * (LON - ha) - eq + FUSO * 60) / 60
  return { nascer, por }
}

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`

function agoraSP(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' })
    .formatToParts(d).map((x) => [x.type, x.value]))
  return Number(p.hour) + Number(p.minute) / 60
}

export function Sol() {
  const [agora, setAgora] = useState<Date | null>(null)
  useEffect(() => {
    setAgora(new Date())
    const t = setInterval(() => setAgora(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  const d = agora ?? new Date()
  const h = agoraSP(d)
  const { nascer, por } = solDoDia(d)
  const meio = (nascer + por) / 2
  const c = (TOPO + BASE) / 2, A = (BASE - TOPO) / 2
  const x = (t: number) => (t / 24) * W
  const y = (t: number) => c - A * Math.cos((2 * Math.PI * (t - meio)) / 24)
  const horizonte = y(nascer)
  const pontos = Array.from({ length: 97 }, (_, i) => i / 4).map((t) => `${x(t).toFixed(1)},${y(t).toFixed(1)}`).join(' L')
  const dia = h >= nascer && h <= por
  const fase = h < nascer - 1 || h > por + 1 ? 'Noite' : h < nascer + 0.5 ? 'Amanhecer' : h > por - 0.5 ? 'Pôr do sol' : h < 12 ? 'Manhã' : 'Tarde'
  const resta = por - h
  const luz = dia ? `${Math.floor(resta)}h${String(Math.round((resta % 1) * 60) % 60).padStart(2, '0')} de luz até o pôr do sol`
    : h < nascer ? `O sol nasce às ${hhmm(nascer)}` : `O sol nasce amanhã às ${hhmm(solDoDia(new Date(d.getTime() + 864e5)).nascer)}`
  const dataLonga = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(d)
  const data = dataLonga.charAt(0).toUpperCase() + dataLonga.slice(1)
  const relogio = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Sao_Paulo' }).format(d)
  const pct = (t: number) => `${((t / 24) * 100).toFixed(2)}%`

  return (
    <section className={`sol-ceu fase-${fase === 'Noite' ? 'noite' : dia ? 'dia' : 'crepusculo'}`} aria-label={`Agora, ${relogio}. ${luz}.`}>
      <div className="sol-arco">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id="sol-ceu"><rect x="0" y="-20" width={W} height={horizonte + 20} /></clipPath>
            <clipPath id="sol-chao"><rect x="0" y={horizonte} width={W} height={H} /></clipPath>
            <linearGradient id="sol-grad" x1="0" x2="1"><stop offset="0" stopColor="#E8A33D" /><stop offset=".5" stopColor="#FFE3A3" /><stop offset="1" stopColor="#E8763D" /></linearGradient>
          </defs>
          <line x1="0" y1={horizonte} x2={W} y2={horizonte} className="sol-horizonte" vectorEffect="non-scaling-stroke" />
          <path d={`M${pontos}`} fill="none" className="sol-noite" clipPath="url(#sol-chao)" vectorEffect="non-scaling-stroke" />
          <path d={`M${pontos}`} fill="none" stroke="url(#sol-grad)" strokeWidth="2" strokeLinecap="round" clipPath="url(#sol-ceu)" opacity=".85" vectorEffect="non-scaling-stroke" />
        </svg>
        {agora && <span className={`sol-disco${dia ? '' : ' abaixo'}`} style={{ left: pct(h), top: `${((y(h) / H) * 100).toFixed(2)}%` }} />}
        <span className="sol-marca" style={{ left: pct(nascer), top: `${((horizonte / H) * 100).toFixed(2)}%`, color: '#C9A574' }}>nascer {hhmm(nascer)}</span>
        <span className="sol-marca" style={{ left: pct(por), top: `${((horizonte / H) * 100).toFixed(2)}%`, color: '#D98A6A' }}>pôr {hhmm(por)}</span>
        <span className="sol-fase" suppressHydrationWarning>{fase}</span>
        <span className="sol-luz" suppressHydrationWarning>{luz}</span>
        <div className="sol-relogio" suppressHydrationWarning>{relogio}</div>
      </div>
      <div className="sol-data"><span suppressHydrationWarning>{data}</span> <span style={{ color: 'var(--dim)' }}>· São Paulo</span></div>
    </section>
  )
}
