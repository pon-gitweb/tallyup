import { useState, type ReactNode } from 'react'
import { signOut, type User } from 'firebase/auth'
import { auth } from '../firebase'
import styles from './SupplierLayout.module.css'

export type SupplierPage =
  | 'supplier-catalogue'
  | 'supplier-connections'
  | 'supplier-specials'
  | 'supplier-orders'
  | 'supplier-account'

type NavGroup = {
  label: string
  items: { key: SupplierPage; label: string; icon: string }[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Manage',
    items: [
      { key: 'supplier-catalogue',   label: 'Catalogue',   icon: '📦' },
      { key: 'supplier-connections', label: 'Connections', icon: '🔗' },
      { key: 'supplier-specials',    label: 'Specials',    icon: '🏷️' },
      { key: 'supplier-orders',      label: 'Orders',      icon: '🛒' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { key: 'supplier-account', label: 'Account', icon: '⚙️' },
    ],
  },
]

export default function SupplierLayout({
  user,
  supplierName,
  page,
  onNavigate,
  children,
}: {
  user: User
  supplierName: string | null
  page: SupplierPage
  onNavigate: (page: SupplierPage) => void
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  function navigate(target: SupplierPage) {
    onNavigate(target)
    setMobileOpen(false)
  }

  const sidebar = (
    <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
      <div className={styles.sidebarTop}>
        <p className={styles.wordmark}>
          <span className={styles.wordmarkAmber}>H</span>osti
        </p>
        {supplierName && (
          <p className={styles.supplierName}>🏢 {supplierName}</p>
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
