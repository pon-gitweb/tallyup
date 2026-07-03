import { useState, type ReactNode } from 'react'
import { signOut, type User } from 'firebase/auth'
import { auth } from '../firebase'
import styles from './FestivalLayout.module.css'

export type FestivalPage =
  | 'projects'
  | 'festival-setup'
  | 'festival-stock'
  | 'festival-purchasing'
  | 'festival-contracts'
  | 'festival-team'
  | 'festival-liveops'
  | 'festival-outcomes'
  | 'festival-suitee'

type NavItem = { key: FestivalPage; label: string; icon: string; amber?: boolean }
type NavGroup = { label: string; items: NavItem[] }

const FESTIVAL_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Plan',
    items: [
      { key: 'festival-setup',      label: 'Event Setup',        icon: '🎪' },
      { key: 'festival-stock',      label: 'Stock & Suppliers',  icon: '📦' },
      { key: 'festival-purchasing', label: 'Purchasing',         icon: '🛒' },
      { key: 'festival-contracts',  label: 'Contracts',          icon: '📋' },
      { key: 'festival-team',       label: 'Team',               icon: '👥' },
    ],
  },
  {
    label: 'During Event',
    items: [
      { key: 'festival-liveops', label: 'Live Operations', icon: '📡', amber: true },
    ],
  },
  {
    label: 'Debrief',
    items: [
      { key: 'festival-outcomes', label: 'Outcomes',   icon: '📊' },
      { key: 'festival-suitee',   label: 'Ask Suitee', icon: '✦' },
    ],
  },
]

export default function FestivalLayout({
  user,
  activeVenueName,
  page,
  onNavigate,
  children,
}: {
  user: User
  activeVenueName: string | null
  page: FestivalPage
  onNavigate: (page: FestivalPage) => void
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  function navigate(target: FestivalPage) {
    onNavigate(target)
    setMobileOpen(false)
  }

  const sidebar = (
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
      <div className={styles.sidebarTop}>
        <p className={styles.wordmark}>
          <span className={styles.wordmarkAmber}>H</span>osti
        </p>
        {activeVenueName && (
          <button type="button" className={styles.switchVenue} onClick={() => navigate('projects')}>
            ← 🎪 {activeVenueName}
          </button>
        )}
      </div>

      <nav className={styles.nav}>
        {FESTIVAL_NAV_GROUPS.map((group) => (
          <div key={group.label} className={styles.navGroup}>
            <p className={styles.navGroupLabel}>{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={[
                  styles.navLink,
                  page === item.key ? styles.navLinkActive : '',
                ].join(' ').trim()}
                style={item.amber ? { color: '#c47b2b' } : undefined}
                onClick={() => navigate(item.key)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
                {item.amber && <span className={styles.liveIndicator} />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className={styles.sidebarBottom}>
        <p className={styles.userEmail}>{user.email}</p>
        <button type="button" className={styles.signOut} onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
    </aside>
  )

  return (
    <div className={styles.shell}>
      {sidebar}
      <main className={styles.main}>
        <div className={styles.mobileHeader}>
          <p className={styles.mobileWordmark}>
            <span style={{ color: '#c47b2b' }}>H</span>osti
          </p>
          <button
            type="button"
            className={styles.hamburger}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? '✕' : '☰'}
          </button>
        </div>
        {children}
      </main>
    </div>
  )
}
