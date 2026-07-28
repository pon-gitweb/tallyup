import { useEffect, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { app, auth, db } from '../firebase'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff Member',
}

type InviteInfo = { email: string; role: string; venueName: string }

function authErrMsg(code: string): string {
  if (code.includes('wrong-password') || code.includes('invalid-credential'))
    return "Incorrect password — try again, or use \"Create account\" if you're new."
  if (code.includes('user-not-found'))
    return 'No account found. Use "Create account" below.'
  if (code.includes('email-already-in-use'))
    return 'An account with this email already exists — sign in instead.'
  if (code.includes('weak-password'))
    return 'Password must be at least 6 characters.'
  if (code.includes('too-many-requests'))
    return 'Too many attempts. Please wait a moment and try again.'
  if (code.includes('network-request-failed'))
    return 'Network error — check your connection and try again.'
  return 'Authentication failed. Please try again.'
}

function acceptErrMsg(e: any): string {
  const code: string = e?.code ?? ''
  const msg: string = e?.message ?? ''
  if (code === 'functions/not-found' || msg.includes('Invite not found'))
    return 'This invite link is no longer valid.'
  if (code === 'functions/failed-precondition' || msg.includes('no longer valid'))
    return 'This invite has been cancelled or is no longer active.'
  if (code === 'functions/deadline-exceeded' || msg.includes('expired'))
    return 'This invite has expired. Ask your manager to send a new one.'
  if (code === 'functions/permission-denied' || msg.includes('different email'))
    return 'This invite was sent to a different email address.'
  return 'Could not accept invite — please try again.'
}

const pg: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: '#f5f3ee', padding: '24px',
}
const card: React.CSSProperties = {
  width: '100%', maxWidth: '400px', background: '#ffffff',
  border: '1px solid #e5e3de', borderRadius: '16px',
  padding: '36px 32px', boxShadow: '0 12px 32px rgba(11,19,43,0.08)',
}
const wordmarkStyle: React.CSSProperties = {
  fontFamily: "'Playfair Display', Georgia, serif", fontSize: '28px',
  fontWeight: 800, color: '#0B132B', margin: '0 0 28px', textAlign: 'center',
}
const headline: React.CSSProperties = {
  fontFamily: "'Playfair Display', Georgia, serif", fontSize: '20px',
  fontWeight: 700, color: '#0B132B', margin: '0 0 6px',
}
const sub: React.CSSProperties = {
  fontSize: '13px', color: '#6b7280', margin: '0 0 20px',
  lineHeight: 1.5, fontFamily: 'Inter, sans-serif',
}
const invitePanel: React.CSSProperties = {
  background: '#f5f3ee', borderRadius: '10px',
  padding: '14px 16px', marginBottom: '24px',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '13px', fontWeight: 600,
  color: '#0B132B', marginBottom: '6px', fontFamily: 'Inter, sans-serif',
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: '15px',
  border: '1.5px solid #e5e3de', borderRadius: '10px',
  background: '#fff', color: '#0B132B', outline: 'none',
  boxSizing: 'border-box', fontFamily: 'Inter, sans-serif', marginBottom: '14px',
}
const inputLocked: React.CSSProperties = { background: '#f5f3ee', color: '#6b7280' }
const btnStyle: React.CSSProperties = {
  width: '100%', padding: '12px', fontSize: '15px', fontWeight: 700,
  color: '#fff', background: '#1b4f72', border: 'none', borderRadius: '10px',
  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
}
const ghostBtn: React.CSSProperties = {
  width: '100%', marginTop: '10px', padding: '10px 12px',
  fontSize: '13px', fontWeight: 600, color: '#6b7280', background: 'none',
  border: '1px solid #e5e3de', borderRadius: '10px', cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
}
const errorBox: React.CSSProperties = {
  fontSize: '13px', color: '#dc2626', background: '#fef2f2',
  border: '1px solid #fecaca', borderRadius: '8px',
  padding: '10px 12px', marginBottom: '16px', fontFamily: 'Inter, sans-serif',
}

export default function AcceptInvitePage({ venueId, inviteId }: { venueId: string; inviteId: string }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [inviteLoading, setInviteLoading] = useState(true)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  // Prevents the auto-accept effect from firing twice on re-renders
  const acceptStartedRef = useRef(false)

  useEffect(() => {
    async function load() {
      try {
        const [venueSnap, inviteSnap] = await Promise.all([
          getDoc(doc(db, 'venues', venueId)),
          getDoc(doc(db, 'venues', venueId, 'invites', inviteId)),
        ])
        const venueName = (venueSnap.data() as any)?.name ?? 'your venue'
        if (!inviteSnap.exists()) {
          setInviteError('This invite link is invalid or has already been used.')
          return
        }
        const data = inviteSnap.data() as any
        if (data.status === 'accepted') {
          setInviteError('This invite has already been accepted.')
          return
        }
        if (data.status !== 'pending') {
          setInviteError('This invite is no longer valid. Ask your manager to send a new one.')
          return
        }
        setInvite({ email: data.email ?? '', role: data.role ?? 'staff', venueName })
      } catch {
        setInviteError('Could not load invite — check your connection and try again.')
      } finally {
        setInviteLoading(false)
      }
    }
    load()
  }, [venueId, inviteId])

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u ?? null))
  }, [])

  // Auto-accept once both user (with matching email) and invite are ready
  useEffect(() => {
    if (!invite || !user || accepted || acceptStartedRef.current) return
    if (user.email?.toLowerCase() !== invite.email.toLowerCase()) return
    acceptStartedRef.current = true
    doAccept()
  }, [user, invite])

  async function doAccept() {
    setAccepting(true)
    setAcceptError(null)
    try {
      const fns = getFunctions(app)
      const callable = httpsCallable(fns, 'acceptInviteCallable')
      await callable({ venueId, inviteId })
      setAccepted(true)
    } catch (e: any) {
      acceptStartedRef.current = false
      setAcceptError(acceptErrMsg(e))
    } finally {
      setAccepting(false)
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!invite) return
    setAuthError(null)
    if (authMode === 'register') {
      if (password !== confirmPassword) { setAuthError('Passwords do not match.'); return }
      if (password.length < 6) { setAuthError('Password must be at least 6 characters.'); return }
    }
    if (!password) { setAuthError('Enter your password.'); return }
    setAuthBusy(true)
    try {
      if (authMode === 'signin') {
        await signInWithEmailAndPassword(auth, invite.email, password)
      } else {
        await createUserWithEmailAndPassword(auth, invite.email, password)
      }
      // onAuthStateChanged fires → setUser → auto-accept effect triggers
    } catch (e: any) {
      setAuthError(authErrMsg(e?.code ?? ''))
    } finally {
      setAuthBusy(false)
    }
  }

  function switchMode(mode: 'signin' | 'register') {
    setAuthMode(mode)
    setPassword('')
    setConfirmPassword('')
    setAuthError(null)
  }

  const wordmark = <h1 style={wordmarkStyle}><span style={{ color: '#c47b2b' }}>H</span>osti</h1>

  // Both invite fetch and auth state must resolve before showing real UI
  if (inviteLoading || user === undefined) {
    return (
      <div style={pg}><div style={card}>
        {wordmark}
        <p style={{ textAlign: 'center', color: '#6b7280', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
          Loading invite…
        </p>
      </div></div>
    )
  }

  if (inviteError) {
    return (
      <div style={pg}><div style={card}>
        {wordmark}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 36, margin: '0 0 12px' }}>🔗</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#0B132B', margin: '0 0 8px', fontFamily: 'Inter, sans-serif' }}>
            Invalid invite
          </p>
          <p style={{ fontSize: 14, color: '#6b7280', fontFamily: 'Inter, sans-serif', lineHeight: 1.5, margin: 0 }}>
            {inviteError}
          </p>
        </div>
      </div></div>
    )
  }

  if (accepted) {
    return (
      <div style={pg}><div style={card}>
        {wordmark}
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 40, margin: '0 0 12px' }}>🎉</p>
          <p style={{ ...headline, textAlign: 'center', margin: '0 0 8px' }}>
            You're in — welcome to {invite!.venueName}!
          </p>
          <p style={{ ...sub, margin: '0 0 24px' }}>
            You've joined as {ROLE_LABELS[invite!.role] ?? invite!.role}. Your account is ready.
          </p>
          <button style={btnStyle} onClick={() => { window.location.href = '/app' }}>
            Open Hosti →
          </button>
        </div>
      </div></div>
    )
  }

  const emailMismatch = user !== null
    && user.email?.toLowerCase() !== invite!.email.toLowerCase()

  return (
    <div style={pg}><div style={card}>
      {wordmark}

      {/* Invite summary */}
      <div style={invitePanel}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 4px', fontFamily: 'Inter, sans-serif' }}>
          You've been invited to join
        </p>
        <p style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: '20px', fontWeight: 700, color: '#0B132B', margin: '0 0 8px' }}>
          {invite!.venueName}
        </p>
        <span style={{ display: 'inline-block', background: '#1b4f72', color: '#fff', fontSize: '12px', fontWeight: 700, borderRadius: '20px', padding: '3px 10px', fontFamily: 'Inter, sans-serif' }}>
          {ROLE_LABELS[invite!.role] ?? invite!.role}
        </span>
      </div>

      {/* Wrong account signed in */}
      {emailMismatch && (
        <>
          <div style={errorBox}>
            This invite is for <strong>{invite!.email}</strong>, but you're signed in as{' '}
            <strong>{user!.email}</strong>. Sign out and use the correct account to accept it.
          </div>
          <button style={btnStyle} onClick={() => signOut(auth)}>Sign out</button>
        </>
      )}

      {/* Matching account — auto-accepting */}
      {user !== null && !emailMismatch && (
        <>
          {accepting && (
            <p style={{ textAlign: 'center', color: '#6b7280', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
              Accepting invite…
            </p>
          )}
          {!accepting && !acceptError && (
            <p style={{ textAlign: 'center', color: '#6b7280', fontFamily: 'Inter, sans-serif', fontSize: 14 }}>
              Verifying your account…
            </p>
          )}
          {acceptError && (
            <>
              <div style={errorBox}>{acceptError}</div>
              <button style={btnStyle} onClick={doAccept}>Try again</button>
            </>
          )}
        </>
      )}

      {/* Not signed in — auth form */}
      {user === null && (
        <>
          <h2 style={headline}>
            {authMode === 'signin' ? 'Sign in to accept' : 'Create account to accept'}
          </h2>
          <p style={sub}>
            {authMode === 'signin'
              ? `Sign in to continue as ${invite!.email}.`
              : `Create an account for ${invite!.email} to accept this invite.`}
          </p>
          {authError && <div style={errorBox}>{authError}</div>}
          <form onSubmit={handleAuth}>
            <label style={labelStyle}>Email</label>
            <input
              style={{ ...inputStyle, ...inputLocked }}
              type="email"
              value={invite!.email}
              readOnly
              tabIndex={-1}
            />
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
            />
            {authMode === 'register' && (
              <>
                <label style={labelStyle}>Confirm password</label>
                <input
                  style={inputStyle}
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </>
            )}
            <button
              type="submit"
              style={{ ...btnStyle, ...(authBusy ? { opacity: 0.6, cursor: 'default' } : {}) }}
              disabled={authBusy}
            >
              {authBusy
                ? (authMode === 'signin' ? 'Signing in…' : 'Creating account…')
                : (authMode === 'signin' ? 'Sign in' : 'Create account')}
            </button>
          </form>
          <button
            type="button"
            style={ghostBtn}
            onClick={() => switchMode(authMode === 'signin' ? 'register' : 'signin')}
          >
            {authMode === 'signin'
              ? "Don't have an account? Create one →"
              : '← Already have an account? Sign in'}
          </button>
        </>
      )}
    </div></div>
  )
}
