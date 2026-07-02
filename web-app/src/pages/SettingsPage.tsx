import { Fragment, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
import styles from './SettingsPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type Role = 'owner' | 'manager' | 'staff'

type VenueData = {
  name: string
  country: string | null
  timezone: string | null
  ownerUid: string | null
}

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

type LabourSettings = {
  hourlyRate: number | null
  baselineMinutes: number | null
  targetDaysOfCover: number | null
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

export default function SettingsPage({ venueId, user }: { venueId: string; user: User }) {
  const [venue, setVenue] = useState<VenueData | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [labour, setLabour] = useState<LabourSettings | null>(null)
  const [loading, setLoading] = useState(true)

  // Venue name inline edit
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)

  // Inline confirm state
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

  // Labour settings — one-shot read
  useEffect(() => {
    getDoc(doc(db, 'venues', venueId, 'settings', 'labour'))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data() as any
          setLabour({
            hourlyRate: d.hourlyRate ?? null,
            baselineMinutes: d.baselineMinutes ?? d.targetCountingMinutes ?? null,
            targetDaysOfCover: d.targetDaysOfCover ?? null,
          })
        }
      })
      .catch(() => {})
  }, [venueId])

  // Live venue doc
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any
          setVenue({
            name: d.name ?? '',
            country: d.country ?? null,
            timezone: d.timezone ?? null,
            ownerUid: d.ownerUid ?? null,
          })
        }
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
              role: (['owner', 'manager', 'staff'].includes(data.role)
                ? data.role
                : 'staff') as Role,
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
  const isVenueOwner = venue?.ownerUid === user.uid
  const myRole: Role | null = isVenueOwner
    ? 'owner'
    : (members.find((m) => m.uid === user.uid)?.role ?? null)
  const canManage = myRole === 'owner' || myRole === 'manager'

  // ── Venue name edit ──────────────────────────────────────────────────────────

  async function saveName() {
    if (!nameInput.trim() || nameSaving) return
    setNameSaving(true)
    try {
      await updateDoc(doc(db, 'venues', venueId), { name: nameInput.trim() })
      setEditingName(false)
    } catch {
      // Firestore will revert via onSnapshot if it fails
    }
    setNameSaving(false)
  }

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

  if (loading) return <p className={styles.loading}>Loading settings…</p>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Settings</h1>
      <p className={styles.subhead}>Venue configuration and team management.</p>

      <div className={styles.twoCol}>

        {/* ── LEFT: Venue Details ── */}
        <div className={styles.leftCol}>
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>Venue Details</h2>

            {/* Name */}
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Venue name</span>
              {editingName ? (
                <div className={styles.editRow}>
                  <input
                    className={styles.editInput}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className={styles.editSave}
                    onClick={saveName}
                    disabled={nameSaving}
                  >
                    {nameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className={styles.editCancel}
                    onClick={() => setEditingName(false)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={styles.fieldValueRow}>
                  <span className={styles.fieldValue}>{venue?.name || '—'}</span>
                  {myRole === 'owner' && (
                    <button
                      type="button"
                      className={styles.pencilBtn}
                      title="Edit venue name"
                      onClick={() => {
                        setNameInput(venue?.name ?? '')
                        setEditingName(true)
                      }}
                    >
                      ✎
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Country */}
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Country</span>
              <span className={styles.fieldValue}>{venue?.country || '—'}</span>
            </div>

            {/* Timezone */}
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Timezone</span>
              <span className={styles.fieldValue}>{venue?.timezone || '—'}</span>
            </div>
          </div>

          {/* Labour Settings */}
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>Labour Settings</h2>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Hourly rate</span>
              <span className={styles.fieldValue}>
                {labour?.hourlyRate != null ? `$${labour.hourlyRate.toFixed(2)}/hr` : '—'}
              </span>
            </div>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Stocktake baseline</span>
              <span className={styles.fieldValue}>
                {labour?.baselineMinutes != null ? `${labour.baselineMinutes} minutes` : '—'}
              </span>
            </div>
            <div className={styles.fieldRow}>
              <span className={styles.fieldLabel}>Target days of cover</span>
              <span className={styles.fieldValue}>
                {labour?.targetDaysOfCover != null ? `${labour.targetDaysOfCover} days` : '—'}
              </span>
            </div>
            <p className={styles.mobileNote}>
              Edit these settings in the mobile app under Settings.
            </p>
          </div>
        </div>

        {/* ── RIGHT: Team Members ── */}
        <div className={styles.rightCol}>
          <div className={styles.card}>
            <div className={styles.cardHeadingRow}>
              <h2 className={styles.cardHeading}>Team</h2>
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
                                <span
                                  className={styles.badge}
                                  style={ROLE_BADGE_STYLE[member.role]}
                                >
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
                              <td
                                colSpan={canManage ? 5 : 4}
                                className={styles.confirmCell}
                              >
                                <span className={styles.confirmText}>
                                  Change {confirmRoleChange.name} to{' '}
                                  <strong>{confirmRoleChange.newRole}</strong>?
                                </span>
                                <button
                                  type="button"
                                  className={styles.confirmYes}
                                  onClick={confirmRoleChangeAction}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  className={styles.confirmNo}
                                  onClick={() => setConfirmRoleChange(null)}
                                >
                                  Cancel
                                </button>
                              </td>
                            </tr>
                          )}

                          {showRemoveConfirm && (
                            <tr className={styles.confirmRow}>
                              <td
                                colSpan={canManage ? 5 : 4}
                                className={styles.confirmCell}
                              >
                                <span className={styles.confirmText}>
                                  Remove{' '}
                                  <strong>{member.displayName || member.email}</strong> from
                                  this venue?
                                </span>
                                <button
                                  type="button"
                                  className={styles.confirmYes}
                                  onClick={confirmRemoveAction}
                                >
                                  Remove
                                </button>
                                <button
                                  type="button"
                                  className={styles.confirmNo}
                                  onClick={() => setConfirmRemoveUid(null)}
                                >
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
                      <button
                        type="button"
                        className={styles.revokeBtn}
                        onClick={() => handleRevokeInvite(invite.id)}
                      >
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
                {inviteStatus === 'error' && (
                  <p className={styles.inviteError}>{inviteMsg}</p>
                )}
                {inviteStatus === 'sent' && (
                  <p className={styles.inviteSuccess}>✓ {inviteMsg}</p>
                )}
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
