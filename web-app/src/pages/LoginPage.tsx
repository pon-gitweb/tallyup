import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from '../firebase'
import styles from './LoginPage.module.css'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid #e5e3de',
  borderRadius: 8, fontSize: 14, color: '#0B132B', background: '#fff',
  marginBottom: 0, boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 700, color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
}

function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-email':         return 'Enter a valid email address.'
    case 'auth/user-not-found':
    case 'auth/invalid-credential':    return 'No account found with those details.'
    case 'auth/wrong-password':        return 'Incorrect password.'
    case 'auth/too-many-requests':     return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':return 'Network error — check your connection and try again.'
    default:                           return 'Could not sign in. Please try again.'
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  const [showSupplierForm, setShowSupplierForm] = useState(false)
  const [regFields, setRegFields] = useState({
    companyName: '', contactName: '', email: '', phone: '', region: '', abn: '',
  })
  const [regStatus, setRegStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [regError, setRegError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setResetSent(false)
    if (!email.trim() || !password) { setError('Enter your email and password.'); return }
    setSubmitting(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err: any) {
      setError(authErrorMessage(err?.code))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleForgotPassword() {
    setError(null); setResetSent(false)
    if (!email.trim()) { setError('Enter your email above first, then tap "Forgot password?".'); return }
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setResetSent(true)
    } catch (err: any) {
      setError(authErrorMessage(err?.code))
    }
  }

  async function handleSupplierRegister(e: React.FormEvent) {
    e.preventDefault()
    if (!regFields.companyName.trim() || !regFields.email.trim()) {
      setRegError('Company name and email are required.'); return
    }
    setRegStatus('submitting'); setRegError(null)
    try {
      const response = await fetch(
        'https://us-central1-tallyup-f1463.cloudfunctions.net/api/supplier-register',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(regFields),
        }
      )
      const data = await response.json()
      if (!data.ok) throw new Error(data.error || 'Registration failed.')
      setRegStatus('done')
    } catch (err: any) {
      setRegError(err?.message || 'Registration failed. Please try again.')
      setRegStatus('idle')
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.wordmark}>
          <span className={styles.wordmarkAmber}>H</span>osti
        </h1>

        {/* ── Login form ── */}
        {!showSupplierForm && (
          <>
            <h2 className={styles.headline}>Welcome back.</h2>
            <p className={styles.subhead}>Sign in to your Hosti dashboard.</p>

            {error && <p className={styles.error}>{error}</p>}
            {resetSent && (
              <p className={styles.confirmation}>Check your email for a password reset link.</p>
            )}

            <form onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Email</label>
                <input id="email" type="email" className={styles.input} value={email}
                  onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">Password</label>
                <input id="password" type="password" className={styles.input} value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              <div className={styles.forgotRow}>
                <button type="button" className={styles.linkButton} onClick={handleForgotPassword}>
                  Forgot password?
                </button>
              </div>
              <button type="submit" className={styles.submit} disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <p className={styles.note}>New to Hosti? Download the app to create your account.</p>
            <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 16 }}>
              Suppliers and venue operators use the same login.
            </p>
            {/* Supplier register link hidden until endpoint is live
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button type="button" onClick={() => setShowSupplierForm(true)}
                style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'Inter, sans-serif' }}>
                Are you a supplier? Register here →
              </button>
            </div>
            */}
          </>
        )}

        {/* ── Supplier registration form ── */}
        {showSupplierForm && regStatus !== 'done' && (
          <form onSubmit={handleSupplierRegister} style={{ width: '100%' }}>
            <h2 style={{ fontFamily: 'Playfair Display, Georgia, serif', fontSize: 22, fontWeight: 800, color: '#0B132B', margin: '0 0 6px' }}>
              Supplier Registration
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>
              Apply to list your products on Hosti. We'll review your application and be in touch within 1–2 business days.
            </p>

            <label style={labelStyle}>Company name *</label>
            <input style={inputStyle} value={regFields.companyName}
              onChange={e => setRegFields(f => ({ ...f, companyName: e.target.value }))}
              placeholder="e.g. Hancocks Wine & Spirits" required />

            <label style={{ ...labelStyle, marginTop: 12 }}>Contact name</label>
            <input style={inputStyle} value={regFields.contactName}
              onChange={e => setRegFields(f => ({ ...f, contactName: e.target.value }))}
              placeholder="Your name" />

            <label style={{ ...labelStyle, marginTop: 12 }}>Email address *</label>
            <input style={inputStyle} type="email" value={regFields.email}
              onChange={e => setRegFields(f => ({ ...f, email: e.target.value }))}
              placeholder="you@company.co.nz" required />

            <label style={{ ...labelStyle, marginTop: 12 }}>Phone</label>
            <input style={inputStyle} type="tel" value={regFields.phone}
              onChange={e => setRegFields(f => ({ ...f, phone: e.target.value }))}
              placeholder="e.g. 09 123 4567" />

            <label style={{ ...labelStyle, marginTop: 12 }}>Region</label>
            <select style={inputStyle} value={regFields.region}
              onChange={e => setRegFields(f => ({ ...f, region: e.target.value }))}>
              <option value="">Select region</option>
              <option value="Auckland">Auckland</option>
              <option value="Wellington">Wellington</option>
              <option value="Christchurch">Christchurch</option>
              <option value="NZ Other">NZ — Other</option>
              <option value="Sydney">Sydney</option>
              <option value="Melbourne">Melbourne</option>
              <option value="AU Other">AU — Other</option>
            </select>

            <label style={{ ...labelStyle, marginTop: 12 }}>ABN or NZBN</label>
            <input style={inputStyle} value={regFields.abn}
              onChange={e => setRegFields(f => ({ ...f, abn: e.target.value }))}
              placeholder="Business number" />

            {regError && <p style={{ fontSize: 13, color: '#dc2626', margin: '10px 0 0' }}>{regError}</p>}

            <button type="submit" disabled={regStatus === 'submitting'}
              style={{ width: '100%', marginTop: 20, padding: '10px 0', background: '#1b4f72', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: regStatus === 'submitting' ? 'not-allowed' : 'pointer', opacity: regStatus === 'submitting' ? 0.6 : 1, fontFamily: 'Inter, sans-serif' }}>
              {regStatus === 'submitting' ? 'Submitting…' : 'Submit application'}
            </button>
            <button type="button" onClick={() => { setShowSupplierForm(false); setRegError(null); setRegStatus('idle') }}
              style={{ width: '100%', marginTop: 8, padding: '8px 0', background: 'none', border: '1px solid #e5e3de', color: '#6b7280', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
              ← Back to login
            </button>
          </form>
        )}

        {/* ── Registration success ── */}
        {showSupplierForm && regStatus === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 40, margin: '0 0 16px' }}>✅</p>
            <h2 style={{ fontFamily: 'Playfair Display, Georgia, serif', fontSize: 22, fontWeight: 800, color: '#0B132B', margin: '0 0 8px' }}>
              Application received
            </h2>
            <p style={{ fontSize: 14, color: '#6b7280', margin: '0 0 24px' }}>
              Thanks {regFields.companyName}. We'll review your application and be in touch at {regFields.email} within 1–2 business days.
            </p>
            <button type="button"
              onClick={() => { setShowSupplierForm(false); setRegStatus('idle'); setRegFields({ companyName: '', contactName: '', email: '', phone: '', region: '', abn: '' }) }}
              style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, color: '#6b7280', cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>
              ← Back to login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
