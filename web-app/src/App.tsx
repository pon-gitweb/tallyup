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
import SettingsPage from './pages/SettingsPage'
import SuiteePage from './pages/SuiteePage'
import HostiHealthPage from './pages/HostiHealthPage'
import TeamPage from './pages/TeamPage'
import ImportPage from './pages/ImportPage'
import DashboardLayout, { type Page } from './layouts/DashboardLayout'
import FestivalLayout, { type FestivalPage } from './layouts/FestivalLayout'
import FestivalEventSetupPage from './pages/FestivalEventSetupPage'
import FestivalPurchasingPage from './pages/FestivalPurchasingPage'
import FestivalContractsPage from './pages/FestivalContractsPage'
import styles from './App.module.css'

function App() {
  // undefined = auth state not yet resolved, null = signed out
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [activeVenue, setActiveVenue] = useState<VenueRow | null>(null)
  const [page, setPage] = useState<Page>('hostihealth')
  const [festivalPage, setFestivalPage] = useState<FestivalPage>('festival-setup')

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (!u) {
        setActiveVenue(null)
        setPage('hostihealth')
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
    if (venue.venueType === 'festival') {
      setFestivalPage('festival-setup')
    } else {
      setPage('hostihealth')
    }
  }

  const noVenuePages: Page[] = ['hostihealth', 'products', 'import', 'suppliers', 'reports', 'orders', 'craftit', 'account', 'suitee', 'team']

  const isFestival = activeVenue?.venueType === 'festival'

  if (isFestival && activeVenue) {
    return (
      <FestivalLayout
        user={user}
        activeVenueName={activeVenue.name}
        page={festivalPage}
        onNavigate={setFestivalPage}
      >
        {festivalPage === 'projects' && (
          <ProjectsPage user={user} activeVenueId={activeVenue.id} onOpenVenue={openVenue} />
        )}
        {festivalPage === 'festival-setup' && (
          <FestivalEventSetupPage venueId={activeVenue.id} user={user} />
        )}
        {festivalPage === 'festival-stock' && (
          <SetupProductsPage venueId={activeVenue.id} />
        )}
        {festivalPage === 'festival-purchasing' && (
          <FestivalPurchasingPage venueId={activeVenue.id} user={user} />
        )}
        {festivalPage === 'festival-contracts' && (
          <FestivalContractsPage venueId={activeVenue.id} />
        )}
        {festivalPage === 'festival-team' && (
          <TeamPage venueId={activeVenue.id} user={user} />
        )}
        {festivalPage === 'festival-liveops' && (
          <div style={{ padding: 32, color: '#6b7280' }}>Live Operations — available during your event</div>
        )}
        {festivalPage === 'festival-outcomes' && (
          <div style={{ padding: 32, color: '#6b7280' }}>Outcomes — available after event close</div>
        )}
        {festivalPage === 'festival-suitee' && (
          <SuiteePage venueId={activeVenue.id} user={user} isFestival={true} />
        )}
      </FestivalLayout>
    )
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
      {page === 'hostihealth'  && activeVenue && <HostiHealthPage venueId={activeVenue.id} />}
      {page === 'products'     && activeVenue && <SetupProductsPage venueId={activeVenue.id} />}
      {page === 'suppliers'    && activeVenue && <SuppliersPage venueId={activeVenue.id} />}
      {page === 'reports'      && activeVenue && <ReportsPage venueId={activeVenue.id} />}
      {page === 'orders'       && activeVenue && <OrdersPage venueId={activeVenue.id} />}
      {page === 'craftit'      && activeVenue && <CraftItPage venueId={activeVenue.id} />}
      {page === 'suitee'       && activeVenue && <SuiteePage venueId={activeVenue.id} user={user} />}
      {page === 'account'      && activeVenue && <SettingsPage venueId={activeVenue.id} user={user} />}
      {page === 'team'         && activeVenue && <TeamPage venueId={activeVenue.id} user={user} />}
      {page === 'import'       && activeVenue && <ImportPage venueId={activeVenue.id} />}
      {noVenuePages.includes(page) && !activeVenue && (
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
