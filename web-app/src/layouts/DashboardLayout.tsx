import { useState, type ReactNode } from 'react'
import { signOut, type User } from 'firebase/auth'
import { auth } from '../firebase'
import styles from './DashboardLayout.module.css'

export type Page =
  | 'projects'
  | 'hostihealth'
  | 'reports'
  | 'orders'
  | 'craftit'
  | 'suitee'
  | 'products'
  | 'import'
  | 'suppliers'
  | 'team'
  | 'account'
  | 'venue-setup'
  | 'pos-mapping'

type NavGroup = {
  label: string
  items: { key: Page; label: string; icon: string }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Analyse',
    items: [
      { key: 'hostihealth',  label: 'Hosti Health', icon: '⬡' },
      { key: 'reports',      label: 'Reports',      icon: '📊' },
      { key: 'orders',       label: 'Orders',       icon: '🛒' },
      { key: 'craftit',      label: 'CraftIt',      icon: '🍹' },
      { key: 'suitee',       label: 'Ask Suitee',   icon: '✦' },
      { key: 'pos-mapping',  label: 'POS Mapping',  icon: '🔗' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { key: 'products',  label: 'Products',  icon: '📦' },
      { key: 'import',    label: 'Import',    icon: '📥' },
      { key: 'suppliers', label: 'Suppliers', icon: '🏢' },
      { key: 'team',        label: 'Team',        icon: '👥' },
      { key: 'account',     label: 'Account',     icon: '⚙️' },
      { key: 'venue-setup', label: 'Venue Setup', icon: '🏗️' },
    ],
  },
]

export default function DashboardLayout({
  user,
  activeVenueName,
  page,
  onNavigate,
  children,
}: {
  user: User
  activeVenueName: string | null
  page: Page
  onNavigate: (page: Page) => void
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  function navigate(target: Page) {
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
          <button
            type="button"
            className={styles.switchVenue}
            onClick={() => navigate('projects')}
          >
            ← {activeVenueName}
          </button>
        )}
      </div>

      <nav className={styles.nav}>
        {NAV_GROUPS.map((group) => (
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
                onClick={() => navigate(item.key)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                {item.label}
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
