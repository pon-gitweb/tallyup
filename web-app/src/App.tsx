import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth } from './firebase'
import LoginPage from './pages/LoginPage'
import ProjectsPage, { type VenueRow } from './pages/ProjectsPage'
import SetupProductsPage from './pages/SetupProductsPage'
import SuppliersPage from './pages/SuppliersPage'
import ReportsPage from './pages/ReportsPage'
import OrdersPage from './pages/OrdersPage'
import CraftItPage from './pages/CraftItPage'
import DashboardLayout, { type Page } from './layouts/DashboardLayout'
import styles from './App.module.css'

function App() {
  // undefined = auth state not yet resolved, null = signed out
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [activeVenue, setActiveVenue] = useState<VenueRow | null>(null)
  const [page, setPage] = useState<Page>('projects')

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (!u) {
        setActiveVenue(null)
        setPage('projects')
      }
    })
  }, [])

  if (user === undefined) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.spinner} />
      </div>
    )
  }

  if (user === null) {
    return <LoginPage />
  }

  function openVenue(venue: VenueRow) {
    setActiveVenue(venue)
    setPage('setup-products')
  }

  return (
    <DashboardLayout
      user={user}
      activeVenueName={activeVenue?.name ?? null}
      page={page}
      onNavigate={setPage}
    >
      {page === 'projects' && (
        <ProjectsPage user={user} activeVenueId={activeVenue?.id ?? null} onOpenVenue={openVenue} />
      )}
      {page === 'setup-products' && activeVenue && <SetupProductsPage venueId={activeVenue.id} />}
      {page === 'suppliers' && activeVenue && <SuppliersPage venueId={activeVenue.id} />}
      {page === 'reports' && activeVenue && <ReportsPage venueId={activeVenue.id} />}
      {page === 'orders' && activeVenue && <OrdersPage venueId={activeVenue.id} />}
      {page === 'craftit' && activeVenue && <CraftItPage venueId={activeVenue.id} />}
      {(page === 'setup-products' || page === 'suppliers' || page === 'reports' || page === 'orders' || page === 'craftit') && !activeVenue && (
        <p className={styles.noVenue}>
          Select a project first —{' '}
          <button type="button" className={styles.noVenueLink} onClick={() => setPage('projects')}>
            go to My Projects
          </button>
        </p>
      )}
    </DashboardLayout>
  )
}

export default App
