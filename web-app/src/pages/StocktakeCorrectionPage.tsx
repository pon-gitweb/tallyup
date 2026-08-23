/**
 * StocktakeCorrectionPage — manager / owner only
 *
 * Desktop wizard for correcting a miscounted stocktake entry.
 * Shows a ripple preview (cycle N + downstream cycle N+1) before any write.
 * All changes are committed in a single atomic Firestore batch and logged to
 * venues/{venueId}/stocktakeCorrections/{id}.
 */

import { useEffect, useState } from 'react'
import { type User } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
import {
  listDepartments,
  listCycles,
  findSnapshotItem,
  previewCorrection,
  commitCorrection,
  type DepartmentRow,
  type CycleRow,
  type SnapshotItem,
  type CorrectionPreview,
} from '../services/stocktakeCorrection'

// ---------------------------------------------------------------------------
// Types / constants
// ---------------------------------------------------------------------------

type Step = 'dept' | 'cycle' | 'item' | 'value' | 'preview' | 'done'

const STEP_LABELS: Record<Step, string> = {
  dept: 'Department',
  cycle: 'Cycle',
  item: 'Item',
  value: 'New Value',
  preview: 'Preview',
  done: 'Done',
}
const STEPS: Step[] = ['dept', 'cycle', 'item', 'value', 'preview', 'done']

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Breadcrumb({ current }: { current: Step }) {
  const idx = STEPS.indexOf(current)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 24 }}>
      {STEPS.filter((s) => s !== 'done').map((s, i) => {
        const stepIdx = STEPS.indexOf(s)
        const done = stepIdx < idx
        const active = s === current
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span style={{ color: theme.border, fontSize: 12 }}>›</span>}
            <span
              style={{
                fontSize: 12,
                fontFamily: theme.fontBody,
                fontWeight: active ? 700 : 400,
                color: done ? theme.success : active ? theme.navy : theme.slateMid,
                textDecoration: done ? 'none' : undefined,
              }}
            >
              {done ? '✓ ' : ''}{STEP_LABELS[s]}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${theme.border}`,
        borderRadius: 14,
        padding: '24px 28px',
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: '0 0 16px',
        fontFamily: theme.fontBody,
        fontWeight: 600,
        fontSize: 15,
        color: theme.navy,
      }}
    >
      {children}
    </p>
  )
}

function Pill({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        marginBottom: 6,
        border: selected ? `2px solid ${theme.deepBlue}` : `1px solid ${theme.border}`,
        borderRadius: 8,
        background: selected ? '#EFF6FF' : '#fff',
        color: selected ? theme.deepBlue : theme.navy,
        fontFamily: theme.fontBody,
        fontSize: 14,
        fontWeight: selected ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        color: theme.slateMid,
        fontFamily: theme.fontBody,
        fontSize: 13,
        cursor: 'pointer',
        marginBottom: 20,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      ← Back
    </button>
  )
}

function fmt(n: number | null, dp = 2): string {
  if (n == null) return '—'
  return n.toFixed(dp)
}

function fmtQty(n: number | null): string {
  if (n == null) return '—'
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

function PreviewTable({ preview }: { preview: CorrectionPreview }) {
  return (
    <div>
      {preview.lines.map((line) => (
        <div key={line.cycleNumber} style={{ marginBottom: 20 }}>
          <p
            style={{
              margin: '0 0 10px',
              fontFamily: theme.fontBody,
              fontSize: 13,
              fontWeight: 600,
              color: theme.slateMid,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Cycle {line.cycleNumber}
            {line.cycleNumber > preview.lines[0].cycleNumber ? ' (downstream)' : ''}
          </p>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: theme.fontBody,
              fontSize: 13,
            }}
          >
            <thead>
              <tr>
                <th style={thStyle}>Field</th>
                <th style={thStyle}>Before</th>
                <th style={thStyle}>After</th>
              </tr>
            </thead>
            <tbody>
              {line.cycleNumber === preview.lines[0].cycleNumber && (
                <PreviewRow
                  label="Actual Closing"
                  before={fmtQty(line.before.totalVarianceQty + (line.before.expectedClosing ?? line.before.totalVarianceQty))}
                  after="(see new value)"
                  changed={false}
                  highlight={false}
                />
              )}
              {line.cycleNumber !== preview.lines[0].cycleNumber && (
                <PreviewRow
                  label="Opening Count"
                  before="(old closing)"
                  after="(corrected closing)"
                  changed={false}
                  highlight={false}
                />
              )}
              <PreviewRow
                label="Total Variance Qty"
                before={fmtQty(line.before.totalVarianceQty)}
                after={fmtQty(line.after.totalVarianceQty)}
                changed={line.before.totalVarianceQty !== line.after.totalVarianceQty}
                highlight
              />
              <PreviewRow
                label="Total Variance $"
                before={line.before.totalVarianceDollars != null ? `$${fmt(line.before.totalVarianceDollars)}` : '—'}
                after={line.after.totalVarianceDollars != null ? `$${fmt(line.after.totalVarianceDollars)}` : '—'}
                changed={line.before.totalVarianceDollars !== line.after.totalVarianceDollars}
                highlight
              />
              <PreviewRow
                label="Unexplained Variance Qty"
                before={fmtQty(line.before.unexplainedVarianceQty)}
                after={fmtQty(line.after.unexplainedVarianceQty)}
                changed={line.before.unexplainedVarianceQty !== line.after.unexplainedVarianceQty}
                highlight
              />
              <PreviewRow
                label="Unexplained Variance $"
                before={line.before.unexplainedVarianceDollars != null ? `$${fmt(line.before.unexplainedVarianceDollars)}` : '—'}
                after={line.after.unexplainedVarianceDollars != null ? `$${fmt(line.after.unexplainedVarianceDollars)}` : '—'}
                changed={line.before.unexplainedVarianceDollars !== line.after.unexplainedVarianceDollars}
                highlight
              />
              <PreviewRow
                label="Below PAR"
                before={String(line.before.belowPAR)}
                after={String(line.after.belowPAR)}
                changed={line.before.belowPAR !== line.after.belowPAR}
                highlight={line.before.belowPAR !== line.after.belowPAR}
              />
              <PreviewRow
                label="Ran to Zero"
                before={String(line.before.ranToZero)}
                after={String(line.after.ranToZero)}
                changed={line.before.ranToZero !== line.after.ranToZero}
                highlight={line.before.ranToZero !== line.after.ranToZero}
              />
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  background: '#f8f7f4',
  color: theme.slateMid,
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.04em',
  borderBottom: `1px solid ${theme.border}`,
}

function PreviewRow({
  label,
  before,
  after,
  changed,
  highlight,
}: {
  label: string
  before: string
  after: string
  changed: boolean
  highlight: boolean
}) {
  const rowBg = changed && highlight ? '#FFF9E6' : 'transparent'
  const cellStyle: React.CSSProperties = {
    padding: '7px 10px',
    borderBottom: `1px solid ${theme.border}`,
    verticalAlign: 'middle',
  }
  return (
    <tr style={{ background: rowBg }}>
      <td style={{ ...cellStyle, color: theme.slateMid, fontSize: 13 }}>{label}</td>
      <td style={{ ...cellStyle, color: theme.navy, fontFamily: 'monospace', fontSize: 13 }}>
        {before}
      </td>
      <td
        style={{
          ...cellStyle,
          color: changed ? theme.amber : theme.navy,
          fontWeight: changed ? 700 : 400,
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      >
        {after}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StocktakeCorrectionPage({
  venueId,
  user,
}: {
  venueId: string
  user: User
}) {
  // ── Role gate ─────────────────────────────────────────────────────────────
  const [roleLoading, setRoleLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId))
        if (cancelled) return
        if ((venueSnap.data() as any)?.ownerUid === user.uid) {
          setCanManage(true)
          setRoleLoading(false)
          return
        }
        const memberSnap = await getDoc(
          doc(db, 'venues', venueId, 'members', user.uid),
        )
        if (cancelled) return
        const r = (memberSnap.data() as any)?.role
        setCanManage(r === 'owner' || r === 'manager')
      } catch {
        if (!cancelled) setCanManage(false)
      } finally {
        if (!cancelled) setRoleLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [venueId, user.uid])

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('dept')

  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [deptsLoading, setDeptsLoading] = useState(false)
  const [selectedDept, setSelectedDept] = useState<DepartmentRow | null>(null)

  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [cyclesLoading, setCyclesLoading] = useState(false)
  const [selectedCycle, setSelectedCycle] = useState<CycleRow | null>(null)

  const [items, setItems] = useState<SnapshotItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState<SnapshotItem | null>(null)

  const [newValue, setNewValue] = useState('')
  const [reason, setReason] = useState('')

  const [preview, setPreview] = useState<CorrectionPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [auditId, setAuditId] = useState<string | null>(null)

  // ── Load departments on mount ─────────────────────────────────────────────
  useEffect(() => {
    setDeptsLoading(true)
    listDepartments(venueId)
      .then(setDepartments)
      .catch(() => {})
      .finally(() => setDeptsLoading(false))
  }, [venueId])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function selectDept(dept: DepartmentRow) {
    setSelectedDept(dept)
    setSelectedCycle(null)
    setSelectedItem(null)
    setNewValue('')
    setReason('')
    setPreview(null)
    setCyclesLoading(true)
    setStep('cycle')
    listCycles(venueId, dept.id)
      .then(setCycles)
      .catch(() => {})
      .finally(() => setCyclesLoading(false))
  }

  function selectCycle(cycle: CycleRow) {
    setSelectedCycle(cycle)
    setSelectedItem(null)
    setNewValue('')
    setReason('')
    setPreview(null)
    setItemsLoading(true)
    setStep('item')
    findSnapshotItem(venueId, selectedDept!.id, cycle.cycleNumber)
      .then((result) => setItems(result?.items ?? []))
      .catch(() => {})
      .finally(() => setItemsLoading(false))
  }

  function selectItem(item: SnapshotItem) {
    setSelectedItem(item)
    setNewValue('')
    setReason('')
    setPreview(null)
    setStep('value')
  }

  async function handlePreview() {
    if (!selectedDept || !selectedCycle || !selectedItem) return
    const parsed = parseFloat(newValue)
    if (isNaN(parsed) || parsed < 0) {
      setPreviewError('Please enter a valid non-negative number.')
      return
    }
    if (parsed === (selectedItem.actualClosing as number)) {
      setPreviewError('New value is the same as the current value — nothing to change.')
      return
    }
    if (!reason.trim()) {
      setPreviewError('Please provide a reason for this correction.')
      return
    }
    setPreviewError(null)
    setPreviewLoading(true)
    try {
      const rawName: string = selectedItem._rawName ?? (selectedItem.name ?? '').toLowerCase().trim()
      const p = await previewCorrection(
        venueId,
        selectedDept.id,
        selectedDept.name,
        selectedCycle.cycleNumber,
        rawName,
        parsed,
      )
      setPreview(p)
      setStep('preview')
    } catch (e: any) {
      setPreviewError(e?.message ?? 'Preview failed — please try again.')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleCommit() {
    if (!selectedDept || !selectedCycle || !selectedItem || !preview) return
    const parsed = parseFloat(newValue)
    if (isNaN(parsed) || parsed < 0) return
    setCommitting(true)
    setCommitError(null)
    try {
      const rawName: string = selectedItem._rawName ?? (selectedItem.name ?? '').toLowerCase().trim()
      const id = await commitCorrection({
        venueId,
        departmentId: selectedDept.id,
        departmentName: selectedDept.name,
        cycleNumber: selectedCycle.cycleNumber,
        rawItemName: rawName,
        newActualClosing: parsed,
        reason: reason.trim(),
        userId: user.uid,
        userEmail: user.email ?? '',
      })
      setAuditId(id)
      setStep('done')
    } catch (e: any) {
      setCommitError(e?.message ?? 'Commit failed — please try again.')
    } finally {
      setCommitting(false)
    }
  }

  function startOver() {
    setStep('dept')
    setSelectedDept(null)
    setSelectedCycle(null)
    setSelectedItem(null)
    setNewValue('')
    setReason('')
    setPreview(null)
    setPreviewError(null)
    setCommitError(null)
    setAuditId(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (roleLoading) {
    return (
      <div style={{ padding: 40, color: theme.slateMid, fontFamily: theme.fontBody }}>
        Loading…
      </div>
    )
  }

  if (!canManage) {
    return (
      <div style={{ padding: 40, maxWidth: 480 }}>
        <h2
          style={{
            fontFamily: theme.fontTitle,
            fontSize: 22,
            color: theme.navy,
            marginBottom: 8,
          }}
        >
          Access Restricted
        </h2>
        <p style={{ fontFamily: theme.fontBody, color: theme.slateMid, lineHeight: 1.6 }}>
          Stocktake corrections are only available to venue owners and managers.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 700 }}>
      {/* Page title */}
      <h2
        style={{
          fontFamily: theme.fontTitle,
          fontSize: 24,
          color: theme.navy,
          marginBottom: 4,
          marginTop: 0,
        }}
      >
        Correct a Stocktake Entry
      </h2>
      <p
        style={{
          fontFamily: theme.fontBody,
          fontSize: 14,
          color: theme.slateMid,
          marginBottom: 28,
          lineHeight: 1.6,
        }}
      >
        Fix a miscounted item. You'll see exactly what changes before anything is saved.
        All edits are logged to your venue's audit trail.
      </p>

      {step !== 'done' && <Breadcrumb current={step} />}

      {/* ── Department ── */}
      {step === 'dept' && (
        <Card>
          <SectionTitle>Select a department</SectionTitle>
          {deptsLoading && (
            <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, fontSize: 14 }}>
              Loading departments…
            </p>
          )}
          {!deptsLoading && departments.length === 0 && (
            <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, fontSize: 14 }}>
              No departments found.
            </p>
          )}
          {departments.map((d) => (
            <Pill
              key={d.id}
              label={d.name}
              selected={selectedDept?.id === d.id}
              onClick={() => selectDept(d)}
            />
          ))}
        </Card>
      )}

      {/* ── Cycle ── */}
      {step === 'cycle' && selectedDept && (
        <>
          <BackButton onClick={() => setStep('dept')} />
          <Card>
            <SectionTitle>Select a cycle — {selectedDept.name}</SectionTitle>
            {cyclesLoading && (
              <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, fontSize: 14 }}>
                Loading cycles…
              </p>
            )}
            {!cyclesLoading && cycles.length === 0 && (
              <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, fontSize: 14 }}>
                No completed cycles found for this department.
              </p>
            )}
            {cycles.map((c) => (
              <Pill
                key={c.cycleNumber}
                label={`Cycle ${c.cycleNumber}${c.closedAt ? ` — closed ${c.closedAt}` : ''}`}
                selected={selectedCycle?.cycleNumber === c.cycleNumber}
                onClick={() => selectCycle(c)}
              />
            ))}
          </Card>
        </>
      )}

      {/* ── Item ── */}
      {step === 'item' && selectedDept && selectedCycle && (
        <>
          <BackButton onClick={() => setStep('cycle')} />
          <Card>
            <SectionTitle>
              Select an item — {selectedDept.name}, Cycle {selectedCycle.cycleNumber}
            </SectionTitle>
            {itemsLoading && (
              <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, fontSize: 14 }}>
                Loading items…
              </p>
            )}
            {!itemsLoading && items.length === 0 && (
              <p style={{ color: theme.slateMid, fontFamily: theme.fontBody, fontSize: 14 }}>
                No items found in this snapshot.
              </p>
            )}
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {items.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectItem(it)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 14px',
                    marginBottom: 4,
                    border:
                      selectedItem === it
                        ? `2px solid ${theme.deepBlue}`
                        : `1px solid ${theme.border}`,
                    borderRadius: 8,
                    background: selectedItem === it ? '#EFF6FF' : '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      fontFamily: theme.fontBody,
                      fontSize: 14,
                      color: theme.navy,
                      fontWeight: selectedItem === it ? 600 : 400,
                    }}
                  >
                    {it.name ?? it._rawName ?? '(unnamed)'}
                  </span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      fontSize: 13,
                      color: theme.slateMid,
                      marginLeft: 16,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {it.actualClosing != null ? `${fmtQty(it.actualClosing)} on hand` : '—'}
                    {it.costPrice != null ? ` · $${fmt(it.costPrice)}/unit` : ''}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* ── Value + Reason ── */}
      {step === 'value' && selectedItem && (
        <>
          <BackButton onClick={() => setStep('item')} />
          <Card>
            <SectionTitle>
              Enter corrected value — {selectedItem.name ?? selectedItem._rawName}
            </SectionTitle>
            <div style={{ marginBottom: 20 }}>
              <p
                style={{
                  fontFamily: theme.fontBody,
                  fontSize: 13,
                  color: theme.slateMid,
                  margin: '0 0 4px',
                }}
              >
                Current recorded count
              </p>
              <p
                style={{
                  fontFamily: 'monospace',
                  fontSize: 20,
                  color: theme.navy,
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                {fmtQty(selectedItem.actualClosing as number | null)}
              </p>
            </div>

            <label
              style={{
                display: 'block',
                fontFamily: theme.fontBody,
                fontSize: 13,
                color: theme.navy,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Corrected count
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="e.g. 12"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                fontFamily: theme.fontBody,
                fontSize: 15,
                color: theme.navy,
                marginBottom: 20,
                boxSizing: 'border-box',
              }}
            />

            <label
              style={{
                display: 'block',
                fontFamily: theme.fontBody,
                fontSize: 13,
                color: theme.navy,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Reason for correction <span style={{ color: theme.error }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Miscount — actual recount confirmed 12 bottles on shelf"
              style={{
                width: '100%',
                padding: '10px 12px',
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                fontFamily: theme.fontBody,
                fontSize: 14,
                color: theme.navy,
                resize: 'vertical',
                marginBottom: 20,
                boxSizing: 'border-box',
              }}
            />

            {previewError && (
              <p
                style={{
                  color: theme.error,
                  fontFamily: theme.fontBody,
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                {previewError}
              </p>
            )}

            <button
              type="button"
              onClick={handlePreview}
              disabled={previewLoading}
              style={{
                padding: '11px 28px',
                background: theme.navy,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontFamily: theme.fontBody,
                fontSize: 14,
                fontWeight: 600,
                cursor: previewLoading ? 'wait' : 'pointer',
                opacity: previewLoading ? 0.7 : 1,
              }}
            >
              {previewLoading ? 'Calculating…' : 'Preview changes →'}
            </button>
          </Card>
        </>
      )}

      {/* ── Preview ── */}
      {step === 'preview' && preview && selectedItem && selectedCycle && selectedDept && (
        <>
          <BackButton onClick={() => setStep('value')} />
          <Card>
            <SectionTitle>Preview — what will change</SectionTitle>

            <div
              style={{
                background: '#FFFBEB',
                border: `1px solid #FCD34D`,
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 20,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: theme.fontBody,
                  fontSize: 13,
                  color: '#92400E',
                  lineHeight: 1.5,
                }}
              >
                <strong>
                  {selectedItem.name ?? selectedItem._rawName} · Cycle{' '}
                  {selectedCycle.cycleNumber} · {selectedDept.name}
                </strong>
                <br />
                Actual closing:{' '}
                <strong>{fmtQty(selectedItem.actualClosing as number | null)}</strong> →{' '}
                <strong>{parseFloat(newValue)}</strong>
                {preview.lines.length > 1 && (
                  <>
                    {' '}· Opening count in Cycle {selectedCycle.cycleNumber + 1} will also update.
                  </>
                )}
              </p>
            </div>

            <PreviewTable preview={preview} />

            <p
              style={{
                fontFamily: theme.fontBody,
                fontSize: 12,
                color: theme.slateMid,
                marginTop: 16,
                marginBottom: 0,
                lineHeight: 1.5,
              }}
            >
              Highlighted rows (amber) show changed values. All changes commit atomically —
              if anything fails, nothing is saved.
            </p>
          </Card>

          <Card>
            <SectionTitle>Reason</SectionTitle>
            <p
              style={{
                fontFamily: theme.fontBody,
                fontSize: 14,
                color: theme.navy,
                margin: 0,
                fontStyle: 'italic',
                lineHeight: 1.6,
              }}
            >
              "{reason}"
            </p>
          </Card>

          {commitError && (
            <p
              style={{
                color: theme.error,
                fontFamily: theme.fontBody,
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {commitError}
            </p>
          )}

          <button
            type="button"
            onClick={handleCommit}
            disabled={committing}
            style={{
              padding: '12px 32px',
              background: theme.deepBlue,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontFamily: theme.fontBody,
              fontSize: 15,
              fontWeight: 700,
              cursor: committing ? 'wait' : 'pointer',
              opacity: committing ? 0.7 : 1,
            }}
          >
            {committing ? 'Saving…' : 'Confirm & Save correction'}
          </button>
          <span
            style={{
              marginLeft: 14,
              fontFamily: theme.fontBody,
              fontSize: 13,
              color: theme.slateMid,
            }}
          >
            This cannot be undone automatically. Check the preview carefully.
          </span>
        </>
      )}

      {/* ── Done ── */}
      {step === 'done' && (
        <div
          style={{
            background: '#F0FDF4',
            border: `1px solid #86EFAC`,
            borderRadius: 14,
            padding: '28px 32px',
            maxWidth: 480,
          }}
        >
          <p
            style={{
              margin: '0 0 8px',
              fontFamily: theme.fontTitle,
              fontSize: 22,
              color: '#166534',
            }}
          >
            ✓ Correction saved
          </p>
          <p
            style={{
              margin: '0 0 20px',
              fontFamily: theme.fontBody,
              fontSize: 14,
              color: '#166534',
              lineHeight: 1.6,
            }}
          >
            {selectedItem?.name ?? selectedItem?._rawName} in {selectedDept?.name} Cycle{' '}
            {selectedCycle?.cycleNumber} has been updated
            {preview && preview.lines.length > 1
              ? ` and the downstream Cycle ${selectedCycle!.cycleNumber + 1} opening count adjusted`
              : ''}
            .
            <br />
            <span style={{ fontSize: 12, opacity: 0.75 }}>Audit ID: {auditId}</span>
          </p>
          <button
            type="button"
            onClick={startOver}
            style={{
              padding: '10px 24px',
              background: theme.navy,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontFamily: theme.fontBody,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Make another correction
          </button>
        </div>
      )}
    </div>
  )
}
