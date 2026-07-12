import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import SupplierLayout, { type SupplierPage } from './layouts/SupplierLayout'
import SupplierCataloguePage from './pages/SupplierCataloguePage'
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
import VenueSetupPage from './pages/VenueSetupPage'
import DashboardLayout, { type Page } from './layouts/DashboardLayout'
import FestivalLayout, { type FestivalPage } from './layouts/FestivalLayout'
import FestivalEventSetupPage from './pages/FestivalEventSetupPage'
import FestivalPurchasingPage from './pages/FestivalPurchasingPage'
import FestivalContractsPage from './pages/FestivalContractsPage'
import styles from './App.module.css'
import { theme } from './theme'

function App() {
  // undefined = auth state not yet resolved, null = signed out
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [activeVenue, setActiveVenue] = useState<VenueRow | null>(null)
  const [page, setPage] = useState<Page>('hostihealth')
  const [festivalPage, setFestivalPage] = useState<FestivalPage>('festival-setup')
  const [supplierPage, setSupplierPage] = useState<SupplierPage>('supplier-catalogue')
  const [supplierName, setSupplierName] = useState<string | null>(null)
  const [accountType, setAccountType] = useState<'venue' | 'supplier' | null>(null)
  const [supplierId, setSupplierId] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (!u) {
        setActiveVenue(null)
        setPage('hostihealth')
        setAccountType(null)
        setSupplierId(null)
        return
      }
      try {
        const userDoc = await getDoc(doc(db, 'users', u.uid))
        if (userDoc.exists()) {
          const data = userDoc.data() as any
          if (data?.supplierId) {
            setAccountType('supplier')
            setSupplierId(data.supplierId)
            try {
              const supplierDoc = await getDoc(doc(db, 'supplierAccounts', data.supplierId))
              if (supplierDoc.exists()) setSupplierName((supplierDoc.data() as any).name ?? null)
            } catch {}
            return
          }
        }
        setAccountType('venue')
      } catch {
        setAccountType('venue')
      }
    })
  }, [])

  if (user === undefined || (user !== null && accountType === null)) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.spinner} />
      </div>
    )
  }

  if (user === null) {
    return <LoginPage />
  }

  if (user && accountType === 'supplier' && supplierId) {
    return (
      <SupplierLayout
        user={user}
        supplierName={supplierName}
        page={supplierPage}
        onNavigate={setSupplierPage}
      >
        {supplierPage === 'supplier-catalogue' && (
          <SupplierCataloguePage supplierId={supplierId} user={user} />
        )}
        {supplierPage === 'supplier-connections' && (
          <div style={{ padding: 32, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>Connections — coming in next build</div>
        )}
        {supplierPage === 'supplier-specials' && (
          <div style={{ padding: 32, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>Specials — coming in next build</div>
        )}
        {supplierPage === 'supplier-orders' && (
          <div style={{ padding: 32, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>Orders — coming in next build</div>
        )}
        {supplierPage === 'supplier-account' && (
          <div style={{ padding: 32, color: '#6b7280', fontFamily: 'Inter, sans-serif' }}>Account — coming in next build</div>
        )}
      </SupplierLayout>
    )
  }

  function openVenue(venue: VenueRow) {
    setActiveVenue(venue)
    if (venue.venueType === 'festival') {
      setFestivalPage('festival-setup')
    } else {
      setPage('hostihealth')
    }
  }

  const noVenuePages: Page[] = ['hostihealth', 'products', 'import', 'suppliers', 'reports', 'orders', 'craftit', 'account', 'suitee', 'team', 'venue-setup', 'pos-mapping']

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
      {page === 'hostihealth'  && activeVenue && <HostiHealthPage venueId={activeVenue.id} onNavigate={(p) => setPage(p as Page)} />}
      {page === 'products'     && activeVenue && <SetupProductsPage venueId={activeVenue.id} />}
      {page === 'suppliers'    && activeVenue && <SuppliersPage venueId={activeVenue.id} />}
      {page === 'reports'      && activeVenue && <ReportsPage venueId={activeVenue.id} onNavigate={(p) => setPage(p as Page)} />}
      {page === 'orders'       && activeVenue && <OrdersPage venueId={activeVenue.id} />}
      {page === 'craftit'      && activeVenue && <CraftItPage venueId={activeVenue.id} />}
      {page === 'suitee'       && activeVenue && <SuiteePage venueId={activeVenue.id} user={user} />}
      {page === 'account'      && activeVenue && <SettingsPage venueId={activeVenue.id} user={user} />}
      {page === 'team'         && activeVenue && <TeamPage venueId={activeVenue.id} user={user} />}
      {page === 'import'       && activeVenue && <ImportPage venueId={activeVenue.id} />}
      {page === 'venue-setup'  && activeVenue && <VenueSetupPage venueId={activeVenue.id} />}
      {page === 'pos-mapping'  && activeVenue && (
        <div style={{ padding: 32, maxWidth: 480 }}>
          <h2 style={{ fontFamily: theme.fontTitle, fontSize: 24, color: theme.navy, marginBottom: 8 }}>
            POS Product Mapping
          </h2>
          <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, marginBottom: 24, lineHeight: 1.6 }}>
            Map your POS products to your Hosti catalogue to complete your sales intelligence.
            Full desktop mapping is coming soon — for now, open the Hosti mobile app and go to
            Settings → POS Integration → Map Products.
          </p>
          <div style={{ background: '#fff', border: `1px solid ${theme.border}`, borderRadius: 14, padding: 20 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: theme.navy, fontFamily: theme.fontBody }}>
              📱 Open on your phone
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: theme.slateMid, fontFamily: theme.fontBody }}>
              Settings → POS Integration → Map Products
            </p>
          </div>
        </div>
      )}
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
