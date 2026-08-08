import { useState } from 'react'
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import styles from './RegisterPage.module.css'

// Mirrors mobile RegisterScreen.tsx mapRegisterError — exact same codes/strings.
function mapRegisterError(e: any): string {
  const code = (e?.code || '').toString()
  if (code.includes('email-already-in-use'))   return 'That email address is already registered.'
  if (code.includes('invalid-email'))           return 'Please enter a valid email address.'
  if (code.includes('weak-password'))           return 'Password must be at least 6 characters.'
  if (code.includes('operation-not-allowed'))   return 'Email/Password sign-in is not enabled.'
  return e?.message ?? 'Registration failed. Please try again.'
}

const AUTH_TIMEOUT = 15000 // mirrors mobile — Firebase Auth has no built-in timeout

export default function RegisterPage({
  onSignIn,
}: {
  onSignIn: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailInUse, setEmailInUse] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const em = email.trim()
    setError(null)
    setEmailInUse(false)

    if (!em || !password)       { setError('Enter your email and password.'); return }
    if (password.length < 6)    { setError('Password must be at least 6 characters.'); return }

    setBusy(true)
    try {
      const authPromise = createUserWithEmailAndPassword(auth, em, password)
      const authTimeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('auth-timeout')), AUTH_TIMEOUT)
      )
      const cred = await Promise.race([authPromise, authTimeoutPromise])

      // Fire-and-forget Firestore write — never block navigation on this.
      // Same doc shape as mobile RegisterScreen.tsx. The venue creation flow
      // ensures this doc exists before it's needed; a slow/failed write here is non-fatal.
      setDoc(doc(db, 'users', cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
        venueId: null,
        activeVenueId: null,
        venueIds: [],
        requiresEmailVerification: true,
      }).catch((err: any) =>
        console.warn('[Register] user doc write failed:', err?.message)
      )

      // Fire-and-forget verification email — user can resend from VerifyEmailPage.
      sendEmailVerification(cred.user).catch((err: any) =>
        console.warn('[Register] verification email failed:', err?.message)
      )

      // onAuthStateChanged in App.tsx fires with the new user (emailVerified=false),
      // which renders VerifyEmailPage automatically. No explicit navigation needed.
    } catch (e: any) {
      if (e?.message === 'auth-timeout') {
        setError('Connection is slow — check your network and try again.')
      } else if (e?.code === 'auth/email-already-in-use') {
        setEmailInUse(true)  // inline prompt with sign-in link; matches mobile Alert.alert intent
      } else if (e?.code) {
        setError(mapRegisterError(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.wordmark}>
          <span className={styles.wordmarkAmber}>H</span>osti
        </h1>

        <h2 className={styles.headline}>Create your account.</h2>
        <p className={styles.subhead}>Get started in minutes.</p>

        {error && <p className={styles.error}>{error}</p>}

        {emailInUse && (
          <div className={styles.inUseBox}>
            <p className={styles.inUseText}>
              An account with this email already exists.
            </p>
            <button type="button" className={styles.inUseBtn} onClick={onSignIn}>
              Sign in instead →
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              className={styles.input}
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="reg-password">Password</label>
            <input
              id="reg-password"
              type="password"
              className={styles.input}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 6 characters"
            />
          </div>
          <button type="submit" className={styles.submit} disabled={busy}>
            {busy ? 'Creating account…' : 'Create account →'}
          </button>
        </form>

        <p className={styles.note}>
          Already have an account?{' '}
          <button type="button" className={styles.linkButton} onClick={onSignIn} disabled={busy}>
            Sign in
          </button>
        </p>
      </div>
    </div>
  )
}
