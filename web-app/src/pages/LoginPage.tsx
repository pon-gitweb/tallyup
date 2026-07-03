import { useState } from 'react'
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth'
import { auth } from '../firebase'
import styles from './LoginPage.module.css'

function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return 'No account found with those details.'
    case 'auth/wrong-password':
      return 'Incorrect password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Network error — check your connection and try again.'
    default:
      return 'Could not sign in. Please try again.'
  }
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResetSent(false)
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
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
    setError(null)
    setResetSent(false)
    if (!email.trim()) {
      setError('Enter your email above first, then tap "Forgot password?".')
      return
    }
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setResetSent(true)
    } catch (err: any) {
      setError(authErrorMessage(err?.code))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.wordmark}>
          <span className={styles.wordmarkAmber}>H</span>osti
        </h1>

        <h2 className={styles.headline}>Welcome back.</h2>
        <p className={styles.subhead}>Sign in to your Hosti dashboard.</p>

        {error && <p className={styles.error}>{error}</p>}
        {resetSent && (
          <p className={styles.confirmation}>Check your email for a password reset link.</p>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>

          <div className={styles.forgotRow}>
            <button
              type="button"
              className={styles.linkButton}
              onClick={handleForgotPassword}
            >
              Forgot password?
            </button>
          </div>

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={styles.note}>
          New to Hosti? Download the app to create your account.
        </p>
        <p style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af', marginTop: 16 }}>
          Suppliers and venue operators use the same login.
        </p>
      </div>
    </div>
  )
}
