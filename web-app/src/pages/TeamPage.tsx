import { Fragment, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
import styles from './TeamPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'owner' | 'manager' | 'staff'

type Member = {
  uid: string
  displayName: string | null
  email: string | null
  role: Role
  joinedAt: Date | null
}

type Invite = {
  id: string
  email: string
  role: Role
  status: string
  createdAt: Date | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_BADGE_STYLE: Record<Role, React.CSSProperties> = {
  owner:   { background: theme.navy,     color: '#ffffff' },
  manager: { background: theme.deepBlue, color: '#ffffff' },
  staff:   { background: '#f3f4f6',      color: theme.slateMid },
}

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner:   'Full access including billing and settings',
  manager: 'Approve counts, reports, invite staff',
  staff:   'Count stock and view their areas',
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeamPage({ venueId, user }: { venueId: string; user: User }) {
  const [ownerUid, setOwnerUid] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)

  // Confirm state
  const [confirmRemoveUid, setConfirmRemoveUid] = useState<string | null>(null)
  const [confirmRoleChange, setConfirmRoleChange] = useState<{
    uid: string
    name: string
    newRole: Role
  } | null>(null)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('staff')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [inviteMsg, setInviteMsg] = useState('')

  // Minimal venue doc — ownerUid only
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        setOwnerUid((snap.data() as any)?.ownerUid ?? null)
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [venueId])

  // Live members
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'members'),
      (snap) => {
        const rows: Member[] = snap.docs.map((d) => {
          const data = d.data() as any
          return {
            uid: d.id,
            displayName: data.displayName ?? data.name ?? null,
            email: data.email ?? null,
            role: (['owner', 'manager', 'staff'].includes(data.role) ? data.role : 'staff') as Role,
            joinedAt: data.joinedAt?.toDate?.() ?? null,
          }
        })
        rows.sort((a, b) => {
          const order: Role[] = ['owner', 'manager', 'staff']
          return order.indexOf(a.role) - order.indexOf(b.role)
        })
        setMembers(rows)
      },
      () => {},
    )
    return unsub
  }, [venueId])

  // Live pending invites
  useEffect(() => {
    const q = query(
      collection(db, 'venues', venueId, 'invites'),
      where('status', '==', 'pending'),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Invite[] = snap.docs
          .map((d) => {
            const data = d.data() as any
            return {
              id: d.id,
              email: data.email ?? '',
              role: (['owner', 'manager', 'staff'].includes(data.role) ? data.role : 'staff') as Role,
              status: data.status ?? 'pending',
              createdAt: data.createdAt?.toDate?.() ?? null,
            }
          })
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
        setInvites(rows)
      },
      () => {},
    )
    return unsub
  }, [venueId])

  // Derived role
  const isVenueOwner = ownerUid === user.uid
  const myRole: Role | null = isVenueOwner
    ? 'owner'
    : (members.find((m) => m.uid === user.uid)?.role ?? null)
  const canManage = myRole === 'owner' || myRole === 'manager'

  // ── Role change ──────────────────────────────────────────────────────────────

  function handleRoleSelectChange(uid: string, displayName: string | null, newRole: Role) {
    if (myRole !== 'owner') return
    setConfirmRemoveUid(null)
    setConfirmRoleChange({ uid, name: displayName || uid, newRole })
  }

  async function confirmRoleChangeAction() {
    if (!confirmRoleChange) return
    try {
      await updateDoc(doc(db, 'venues', venueId, 'members', confirmRoleChange.uid), {
        role: confirmRoleChange.newRole,
      })
    } catch {}
    setConfirmRoleChange(null)
  }

  // ── Remove member ────────────────────────────────────────────────────────────

  function handleRemoveClick(uid: string) {
    setConfirmRoleChange(null)
    setConfirmRemoveUid(uid)
  }

  async function confirmRemoveAction() {
    if (!confirmRemoveUid) return
    try {
      await deleteDoc(doc(db, 'venues', venueId, 'members', confirmRemoveUid))
    } catch {}
    setConfirmRemoveUid(null)
  }

  // ── Revoke invite ────────────────────────────────────────────────────────────

  async function handleRevokeInvite(id: string) {
    try {
      await deleteDoc(doc(db, 'venues', venueId, 'invites', id))
    } catch {}
  }

  // ── Send invite ──────────────────────────────────────────────────────────────

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault()
    const email = inviteEmail.trim()
    if (!isValidEmail(email)) {
      setInviteStatus('error')
      setInviteMsg('Enter a valid email address.')
      return
    }
    setInviteStatus('sending')
    setInviteMsg('')
    try {
      await addDoc(collection(db, 'venues', venueId, 'invites'), {
        email,
        role: inviteRole,
        status: 'pending',
        createdAt: serverTimestamp(),
        invitedBy: user.uid,
      })
      setInviteStatus('sent')
      setInviteMsg(`Invite sent to ${email}`)
      setInviteEmail('')
      setInviteRole('staff')
      setTimeout(() => { setInviteStatus('idle'); setInviteMsg('') }, 5000)
    } catch {
      setInviteStatus('error')
      setInviteMsg('Failed to send invite. Please try again.')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <p className={styles.loading}>Loading team…</p>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Team</h1>
      <p className={styles.subhead}>Manage your venue team, roles, and invitations.</p>

      <div className={styles.card}>
        <div className={styles.cardHeadingRow}>
          <h2 className={styles.cardHeading}>Team members</h2>
          <span className={styles.memberCount}>
            {members.length} member{members.length !== 1 ? 's' : ''}
          </span>
        </div>

        {members.length === 0 ? (
          <p className={styles.emptyNote}>No team members found.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.uid === user.uid
                  const showRoleConfirm = confirmRoleChange?.uid === member.uid
                  const showRemoveConfirm = confirmRemoveUid === member.uid
                  return (
                    <Fragment key={member.uid}>
                      <tr className={styles.dataRow}>
                        <td className={styles.td}>
                          {member.displayName || '—'}
                          {isSelf && <span className={styles.youBadge}>you</span>}
                        </td>
                        <td className={styles.td}>{member.email || '—'}</td>
                        <td className={styles.td}>
                          {myRole === 'owner' && !isSelf ? (
                            <select
                              className={styles.roleSelect}
                              value={confirmRoleChange?.uid === member.uid
                                ? confirmRoleChange.newRole
                                : member.role}
                              onChange={(e) =>
                                handleRoleSelectChange(
                                  member.uid,
                                  member.displayName,
                                  e.target.value as Role,
                                )
                              }
                            >
                              <option value="staff">Staff</option>
                              <option value="manager">Manager</option>
                              <option value="owner">Owner</option>
                            </select>
                          ) : (
                            <span className={styles.badge} style={ROLE_BADGE_STYLE[member.role]}>
                              {member.role}
                            </span>
                          )}
                        </td>
                        <td className={styles.td}>{fmtDate(member.joinedAt)}</td>
                        {canManage && (
                          <td className={styles.actionCell}>
                            {!isSelf && (
                              <button
                                type="button"
                                className={styles.removeBtn}
                                onClick={() => handleRemoveClick(member.uid)}
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        )}
                      </tr>

                      {showRoleConfirm && (
                        <tr className={styles.confirmRow}>
                          <td colSpan={canManage ? 5 : 4} className={styles.confirmCell}>
                            <span className={styles.confirmText}>
                              Change {confirmRoleChange.name} to{' '}
                              <strong>{confirmRoleChange.newRole}</strong>?
                            </span>
                            <button type="button" className={styles.confirmYes} onClick={confirmRoleChangeAction}>
                              Confirm
                            </button>
                            <button type="button" className={styles.confirmNo} onClick={() => setConfirmRoleChange(null)}>
                              Cancel
                            </button>
                          </td>
                        </tr>
                      )}

                      {showRemoveConfirm && (
                        <tr className={styles.confirmRow}>
                          <td colSpan={canManage ? 5 : 4} className={styles.confirmCell}>
                            <span className={styles.confirmText}>
                              Remove <strong>{member.displayName || member.email}</strong> from this venue?
                            </span>
                            <button type="button" className={styles.confirmYes} onClick={confirmRemoveAction}>
                              Remove
                            </button>
                            <button type="button" className={styles.confirmNo} onClick={() => setConfirmRemoveUid(null)}>
                              Cancel
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className={styles.invitesSection}>
            <h3 className={styles.invitesSectionHeading}>Pending Invites</h3>
            {invites.map((invite) => (
              <div key={invite.id} className={styles.inviteRow}>
                <span className={styles.inviteEmail}>{invite.email}</span>
                <span className={styles.badge} style={ROLE_BADGE_STYLE[invite.role]}>
                  {invite.role}
                </span>
                {canManage && (
                  <button type="button" className={styles.revokeBtn} onClick={() => handleRevokeInvite(invite.id)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Invite form */}
        {canManage && (
          <form className={styles.inviteForm} onSubmit={handleSendInvite}>
            <h3 className={styles.inviteFormHeading}>Invite someone</h3>
            <div className={styles.inviteFields}>
              <input
                className={styles.inviteEmailInput}
                type="email"
                placeholder="Email address"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value)
                  if (inviteStatus !== 'idle') { setInviteStatus('idle'); setInviteMsg('') }
                }}
              />
              <div className={styles.roleSelectWrap}>
                <select
                  className={styles.inviteRoleSelect}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                >
                  <option value="staff">Staff</option>
                  {myRole === 'owner' && <option value="manager">Manager</option>}
                  {myRole === 'owner' && <option value="owner">Owner</option>}
                </select>
              </div>
              <button
                type="submit"
                className={styles.inviteBtn}
                disabled={inviteStatus === 'sending'}
              >
                {inviteStatus === 'sending' ? 'Sending…' : 'Send invite'}
              </button>
            </div>
            <p className={styles.roleDesc}>{ROLE_DESCRIPTIONS[inviteRole]}</p>
            {inviteStatus === 'error' && <p className={styles.inviteError}>{inviteMsg}</p>}
            {inviteStatus === 'sent' && <p className={styles.inviteSuccess}>✓ {inviteMsg}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
