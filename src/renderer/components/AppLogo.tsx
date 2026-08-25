import React from 'react'

export interface AppLogoProps {
  size?: number
  className?: string
  style?: React.CSSProperties
}

export default function AppLogo({ size = 28, className, style }: AppLogoProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-label="2G/3G/4G QoS Logo"
      role="img"
    >
      <defs>
        <linearGradient id="appLogoBg" x1="0" y1="0" x2="128" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0d1527" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="appLogoCyan" x1="0" y1="128" x2="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0284c7" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id="appLogoGreen" x1="0" y1="128" x2="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <radialGradient id="appLogoGlow" cx="64" cy="24" r="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
        <filter id="appLogoShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#000" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Rounded container with subtle border */}
      <rect
        x="4"
        y="4"
        width="120"
        height="120"
        rx="28"
        fill="url(#appLogoBg)"
        stroke="rgba(56, 189, 248, 0.3)"
        strokeWidth="2.5"
        filter="url(#appLogoShadow)"
      />

      {/* Pulse Beacon Glow */}
      <circle cx="64" cy="24" r="16" fill="url(#appLogoGlow)" />

      {/* Radiating Antenna Waves */}
      <path
        d="M46 28 C46 18 82 18 82 28"
        stroke="#38bdf8"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M34 22 C34 6 94 6 94 22"
        stroke="#38bdf8"
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.45"
      />

      {/* Central Telecom Mast Node */}
      <circle cx="64" cy="24" r="4" fill="#38bdf8" />

      {/* Ascending Signal Bars (2G, 3G, 4G, SLA Target) */}
      {/* 2G Bar */}
      <rect x="26" y="78" width="14" height="26" rx="5" fill="url(#appLogoCyan)" />
      {/* 3G Bar */}
      <rect x="46" y="62" width="14" height="42" rx="5" fill="url(#appLogoCyan)" />
      {/* 4G Bar */}
      <rect x="66" y="46" width="14" height="58" rx="5" fill="url(#appLogoCyan)" />
      {/* SLA Target / Peak Bar */}
      <rect x="86" y="32" width="14" height="72" rx="5" fill="url(#appLogoGreen)" />
    </svg>
  )
}
