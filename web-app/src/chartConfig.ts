import type { CSSProperties } from 'react'
import { theme } from './theme'

export const CHART_TOOLTIP_STYLE: CSSProperties = {
  background: theme.white,
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  fontSize: 13,
  fontFamily: theme.fontBody,
  boxShadow: '0 4px 16px rgba(11,19,43,0.08)',
  padding: '10px 14px',
  color: theme.navy,
}

export const CHART_GRID_PROPS = {
  stroke: '#f0ede6',
  strokeDasharray: '0',
  vertical: false,
}

export const CHART_AXIS_TICK = {
  fontSize: 11,
  fontFamily: theme.fontBody,
  fill: theme.slateMid,
}

export const CHART_DOT = {
  r: 3,
  fill: theme.white,
  strokeWidth: 2,
}

export const CHART_ACTIVE_DOT = {
  r: 6,
  strokeWidth: 0,
}

export const CHART_ANIMATION = {
  isAnimationActive: true,
  animationDuration: 600,
  animationEasing: 'ease-out' as const,
}

// Generous heights — data deserves room
export const CHART_HEIGHT_LINE = 260
export const CHART_HEIGHT_BAR = 240
export const CHART_HEIGHT_SMALL = 200

export const gradientId = (name: string) => `gradient-${name}`
