// Minimal stroke icon set (24×24 grid, 1.75 stroke) · no external icon dependency.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = (size = 24): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

export const IcWind = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 8h11a3 3 0 1 0-3-3" />
    <path d="M3 12h16a3 3 0 1 1-3 3" />
    <path d="M3 16h7" />
  </svg>
)
export const IcRecirc = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 15c0-5 4-9 9-9h3" />
    <path d="m15 3 3 3-3 3" />
    <path d="M4 19h16" />
  </svg>
)
export const IcTemp = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0Z" />
    <path d="M12 9v7" />
  </svg>
)
export const IcFan = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="1.6" />
    <path d="M12 10.4c0-4 1-7 3.5-7S19 6 15 9.5" />
    <path d="M13.6 12c4 0 7 1 7 3.5S18 19 14.5 15" />
    <path d="M12 13.6c0 4-1 7-3.5 7S5 18 9 14.5" />
    <path d="M10.4 12c-4 0-7-1-7-3.5S6 5 9.5 9" />
  </svg>
)
export const IcSeat = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 3v9a3 3 0 0 0 3 3h7" />
    <path d="M17 15v5" />
    <path d="M7 20h11" />
    <path d="M7 12h6" />
  </svg>
)
export const IcLight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z" />
  </svg>
)
export const IcPin = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" />
    <circle cx="12" cy="9" r="2.5" />
  </svg>
)
export const IcCoffee = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" />
    <path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17" />
    <path d="M8 3v3M12 3v3" />
  </svg>
)
export const IcMoon = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
)
export const IcSun = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
export const IcMic = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)
export const IcSpeaker = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 10v4h4l5 4V6L8 10H4Z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
)
export const IcPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" />
  </svg>
)
export const IcPause = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" />
  </svg>
)
export const IcBolt = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </svg>
)
export const IcEye = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)
export const IcCar = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M3 16v-4l2.2-5A2 2 0 0 1 7 6h10a2 2 0 0 1 1.8 1l2.2 5v4H3zM3 12h18" />
    <circle cx="7" cy="17" r="2" />
    <circle cx="17" cy="17" r="2" />
  </svg>
)
export const IcAlert = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
)
export const IcCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
export const IcWindow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 18V9l6-5h10v14H4Z" />
    <path d="M4 13h16" />
  </svg>
)
export const IcSpark = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
)

/** KKAEUM brand mark: a sunrise over the horizon inside an eye · "waking" before drowsiness. */
export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <defs>
      <linearGradient id="kg" x1="0" y1="0" x2="32" y2="32">
        <stop offset="0" stopColor="#3CF2C8" />
        <stop offset="1" stopColor="#5AB8FF" />
      </linearGradient>
    </defs>
    <path d="M3 18c3.2-5.6 8-8.4 13-8.4S25.8 12.4 29 18" stroke="url(#kg)" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M10 18a6 6 0 0 1 12 0" stroke="url(#kg)" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M5 22.5h22" stroke="url(#kg)" strokeWidth="2.4" strokeLinecap="round" opacity=".55" />
    <path d="M16 5v2.4M8.5 7.6l1.3 1.6M23.5 7.6l-1.3 1.6" stroke="url(#kg)" strokeWidth="2" strokeLinecap="round" />
  </svg>
)
