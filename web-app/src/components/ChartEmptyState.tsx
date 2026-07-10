import { theme } from '../theme'

interface ChartEmptyStateProps {
  icon?: string
  title: string
  body: string
  action?: {
    label: string
    onClick: () => void
  }
  height?: number
}

export function ChartEmptyState({
  icon = '📊',
  title,
  body,
  action,
  height = 240,
}: ChartEmptyStateProps) {
  return (
    <div style={{
      height,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 32px',
      gap: 8,
    }}>
      <div style={{
        width: 40, height: 40,
        borderRadius: 12,
        background: '#f5f3ee',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
        marginBottom: 4,
      }}>
        {icon}
      </div>

      <p style={{
        margin: 0,
        fontSize: 14,
        fontWeight: 600,
        color: theme.navy,
        fontFamily: theme.fontBody,
        textAlign: 'center',
      }}>
        {title}
      </p>

      <p style={{
        margin: 0,
        fontSize: 13,
        color: theme.slateMid,
        fontFamily: theme.fontBody,
        textAlign: 'center',
        lineHeight: 1.5,
        maxWidth: 280,
      }}>
        {body}
      </p>

      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 8,
            background: 'none',
            border: `1px solid ${theme.border}`,
            borderRadius: 999,
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: theme.deepBlue,
            fontFamily: theme.fontBody,
            cursor: 'pointer',
          }}
        >
          {action.label} →
        </button>
      )}
    </div>
  )
}
