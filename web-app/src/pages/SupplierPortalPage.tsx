import type { User } from 'firebase/auth'
import { signOut } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

export default function SupplierPortalPage({ supplierId, user }: { supplierId: string; user: User }) {
  const [supplierName, setSupplierName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDoc(doc(db, 'supplierAccounts', supplierId))
      .then(snap => {
        if (snap.exists()) setSupplierName((snap.data() as any).name ?? null)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [supplierId])

  return (
    <div style={{ minHeight: '100vh', background: '#f5f3ee', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ background: '#fff', border: '1px solid #e5e3de', borderRadius: 16, padding: 48, maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <p style={{ fontSize: 32, margin: '0 0 8px' }}>🏢</p>
        <h1 style={{ fontFamily: 'Playfair Display, Georgia, serif', fontSize: 28, fontWeight: 800, color: '#0B132B', margin: '0 0 8px' }}>
          {loading ? 'Loading…' : (supplierName ?? 'Supplier Portal')}
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 32px' }}>
          Supplier portal — coming soon. Your catalogue management, connections, specials, and orders will be available here.
        </p>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 24px' }}>
          Logged in as {user.email}
        </p>
        <button
          type="button"
          onClick={() => signOut(auth)}
          style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
