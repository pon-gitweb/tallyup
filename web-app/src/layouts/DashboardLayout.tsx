import { useState, type ReactNode } from 'react'
import { signOut, type User } from 'firebase/auth'
import { auth } from '../firebase'
import styles from './DashboardLayout.module.css'

export type Page = 'projects' | 'setup-products' | 'suppliers' | 'reports' | 'craftit' | 'orders' | 'settings'

const NAV_ITEMS: { key: Page; label: string; enabled: boolean }[] = [
  { key: 'projects', label: 'Projects', enabled: true },
  { key: 'setup-products', label: 'Setup', enabled: true },
  { key: 'suppliers', label: 'Suppliers', enabled: true },
  { key: 'reports', label: 'Reports', enabled: true },
  { key: 'craftit', label: 'CraftIt', enabled: true },
  { key: 'orders', label: 'Orders', enabled: true },
  { key: 'settings', label: 'Settings', enabled: true },
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
        {activeVenueName && <p className={styles.activeVenueName}>{activeVenueName}</p>}
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={[
              styles.navLink,
              page === item.key ? styles.navLinkActive : '',
              !item.enabled ? styles.navLinkDisabled : '',
            ].join(' ').trim()}
            onClick={() => item.enabled && navigate(item.key)}
            disabled={!item.enabled}
          >
            {item.label}
          </button>
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
