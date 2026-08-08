import { useState } from 'react'
import type { User } from 'firebase/auth'
import { reload, sendEmailVerification, signOut } from 'firebase/auth'
import { auth } from '../firebase'
import styles from './VerifyEmailPage.module.css'

// Mirrors mobile EmailVerificationScreen.tsx — same regex, same exact error strings.
function maskEmail(email: string): string {
  return email.replace(/(.{2})(.*)(@.*)/, (_, a, _b, c) => `${a}***${c}`)
}

export default function VerifyEmailPage({
  user,
  onVerified,
}: {
  user: User
  onVerified: () => void
}) {
  const [checking, setChecking] = useState(false)
  const [resending, setResending] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [resendConfirm, setResendConfirm] = useState(false)

  const maskedEmail = user.email ? maskEmail(user.email) : 'your email'

  async function handleCheckVerification() {
    setChecking(true)
    setCheckError(null)
    setResendConfirm(false)
    try {
      await reload(user)
      const refreshed = auth.currentUser
      if (refreshed?.emailVerified) {
        onVerified()
        // onVerified updates App's user state; component unmounts naturally
      } else {
        setCheckError('Not verified yet. Check your inbox and tap the link first.')
      }
    } catch {
      setCheckError('Could not check status. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  async function handleResend() {
    setResending(true)
    setCheckError(null)
    setResendConfirm(false)
    try {
      await sendEmailVerification(user)
      setResendConfirm(true)
    } catch {
      setCheckError('Could not resend. Please wait a moment and try again.')
    } finally {
      setResending(false)
    }
  }

  async function handleStartOver() {
    // Sign out and App's onAuthStateChanged routes back to LoginPage automatically.
    await signOut(auth)
  }

  const busy = checking || resending

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.wordmark}>
          <span className={styles.wordmarkAmber}>H</span>osti
        </h1>

        <p className={styles.icon}>📬</p>
        <h2 className={styles.headline}>Check your inbox</h2>
        <p className={styles.subhead}>
          We sent a verification link to{' '}
          <strong className={styles.maskedEmail}>{maskedEmail}</strong>.
          Open the email and tap the link, then come back here.
        </p>

        {checkError && <p className={styles.error}>{checkError}</p>}
        {resendConfirm && (
          <p className={styles.confirmation}>✓ Email resent — check your inbox.</p>
        )}

        <button
          type="button"
          className={styles.submit}
          onClick={handleCheckVerification}
          disabled={busy}
        >
          {checking ? 'Checking…' : "✓ I've verified my email"}
        </button>

        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleResend}
          disabled={busy}
        >
          {resending ? 'Sending…' : 'Resend email'}
        </button>

        <button
          type="button"
          className={styles.ghostBtn}
          onClick={handleStartOver}
          disabled={busy}
        >
          Wrong email? Start over
        </button>
      </div>
    </div>
  )
}
