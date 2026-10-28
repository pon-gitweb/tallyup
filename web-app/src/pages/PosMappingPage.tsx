import { useEffect, useMemo, useState } from 'react'
import {
  collection, collectionGroup, doc, getDocs, getDoc, query, where,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import {
  partitionReports, buildUnmatchedRows, matchDocToMatchData,
  normName as wlNormName,
  type ActiveReport, type MatchData, type UnmatchedRow,
} from '../utils/weeklyLedger'
import { mappingDocId } from '../utils/mappingId'
import { parseProductSize } from '../utils/productSize'
import { stripUndefinedDeep } from '../utils/stripUndefinedDeep'
import styles from './PosMappingPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
  id: string
  name: string
  size?: string | null
  unit?: string | null
  mergedInto?: string | null
  category?: string | null
}
type Recipe  = { id: string; name: string }
type Mapping = {
  id: string
  posItemName: string
  posSystem: string
  mappingType: string
  productId?: string | null
  productName?: string | null
  recipeId?: string | null
  recipeName?: string | null
  servingMl?: number | null
  conversionRatio?: number | null
  servingType?: string | null
  conversionUnit?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

export type NoServingRow = {
  posName: string
  normalisedName: string
  productId: string
  productName: string
  totalQty: number
  reportIds: string[]
}

export type AllMappingRow = {
  mapping: Mapping
  targetLabel: string
  servingLabel: string
  ratio: number | null
  seenInReports: number
  totalQtySold: number
  warningMergedOrMissing: boolean
  warningNoServing: boolean
  docCount: number
  warningDuplicate: boolean
  allMappingIds: string[]
  versioned: boolean
  versionCount: number
}

type TabKey = 'not-linked' | 'no-serving' | 'all-mappings'

// ── Serving presets ───────────────────────────────────────────────────────────

const SERVING_PRESETS = [
  { label: 'Each (1:1)', type: 'each',       ml: null  },
  { label: 'Shot 30ml',  type: 'shot',        ml: 30    },
  { label: 'Wine 150ml', type: 'wine_glass',  ml: 150   },
  { label: 'Schooner',   type: 'schooner',    ml: 425   },
  { label: 'Pint',       type: 'pint',        ml: 568   },
  { label: 'Half pint',  type: 'half_pint',   ml: 284   },
  { label: 'Custom ml',  type: 'custom',      ml: null  },
]

function productSizeInMl(p: Product): number | null {
  if (!p.size) return null
  const parsed = parseProductSize(p.size, p.unit)
  if (!parsed || parsed.base !== 'ml') return null
  return parsed.amount
}

// ── Pure exports (used by tests) ──────────────────────────────────────────────

export function buildNotLinkedRows(
  rows: UnmatchedRow[],
  mappingsByLower: Record<string, { mappingType: string }>,
): UnmatchedRow[] {
  return rows.filter(r => !mappingsByLower[(r.origName || '').toLowerCase()])
}

type MappingIndex = Record<string, { mappingType: string; servingMl?: number | null; conversionRatio?: number | null }>

function hasFiniteSize(mp: { servingMl?: number | null; conversionRatio?: number | null }): boolean {
  return (mp.servingMl != null && isFinite(mp.servingMl) && mp.servingMl > 0)
    || (mp.conversionRatio != null && isFinite(mp.conversionRatio) && mp.conversionRatio > 0)
}

export function buildNoServingRows(
  activeReports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
  mappingsByLower: MappingIndex = {},
): NoServingRow[] {
  const byNorm = new Map<string, NoServingRow>()
  for (const r of activeReports) {
    const md = matchesByReport[r.id]
    if (!md) continue
    for (const m of md.matches) {
      const src = m.conversionSource
      if (src === 'servingMl' || src === 'conversionRatio' || src === 'each') continue
      if (src !== 'default' && src != null) continue
      if (src == null) {
        const key = (m.name ?? '').toLowerCase()
        const mp = mappingsByLower[key]
        if (mp) {
          if (mp.mappingType === 'recipe' || mp.mappingType === 'skipped') continue
          if (hasFiniteSize(mp)) continue
        }
      }
      const name = (m.name ?? m.productName ?? '').trim()
      if (!name || !m.productId) continue
      const nn = wlNormName(name)
      if (!byNorm.has(nn)) {
        byNorm.set(nn, { posName: name, normalisedName: nn, productId: m.productId!, productName: m.productName ?? '', totalQty: 0, reportIds: [] })
      }
      const row = byNorm.get(nn)!
      row.totalQty += m.qtySold ?? 0
      if (!row.reportIds.includes(r.id)) row.reportIds.push(r.id)
    }
  }
  return [...byNorm.values()].sort((a, b) => b.totalQty - a.totalQty)
}

export function servingPreviewText(servingMl: number, productSizeMl: number): string {
  if (servingMl <= 0 || productSizeMl <= 0) return ''
  const ratio = servingMl / productSizeMl
  const ratioStr = ratio < 0.01 ? ratio.toFixed(4) : ratio.toFixed(3).replace(/\.?0+$/, '')
  return `1 sale = ${ratioStr} stock units (${servingMl}ml of ${productSizeMl}ml bottle)`
}

export function buildSavePayload(
  posItemName: string,
  posSystem: string,
  mappingType: 'direct_product' | 'recipe' | 'skipped',
  opts: {
    productId?: string | null
    productName?: string | null
    recipeId?: string | null
    recipeName?: string | null
    servingMl?: number | null
    conversionRatio?: number | null
    servingType?: string | null
    conversionUnit?: string | null
  },
): Record<string, unknown> {
  return stripUndefinedDeep({
    posItemName,
    posSystem,
    mappingType,
    productId:       opts.productId       ?? null,
    productName:     opts.productName     ?? null,
    recipeId:        opts.recipeId        ?? null,
    recipeName:      opts.recipeName      ?? null,
    servingMl:       opts.servingMl       ?? null,
    conversionRatio: opts.conversionRatio ?? null,
    servingType:     opts.servingType     ?? null,
    conversionUnit:  opts.conversionUnit  ?? null,
  })
}

export function computeServingFields(
  preset: string,
  customMl: string,
  sizeMl: number | null,
): { servingMl: number | null; conversionRatio: number | null; servingType: string; conversionUnit: string } | { skip: string } {
  if (preset === 'each') {
    return { servingMl: null, conversionRatio: null, servingType: 'each', conversionUnit: 'each' }
  }
  if (preset === 'full_bottle') {
    if (sizeMl == null) return { skip: 'full_bottle with unknown size' }
    return { servingMl: sizeMl, conversionRatio: 1, servingType: 'full_bottle', conversionUnit: 'ml' }
  }
  const presetDef = SERVING_PRESETS.find(p => p.type === preset)
  let ml: number | null = presetDef?.ml ?? null
  if (preset === 'custom') {
    const v = parseFloat(customMl)
    ml = isNaN(v) || v <= 0 ? null : v
  }
  const conversionRatio = ml != null && sizeMl != null ? ml / sizeMl : null
  return { servingMl: ml, conversionRatio, servingType: preset, conversionUnit: 'ml' }
}

export function buildEditPayload(
  existing: Pick<Mapping, 'posItemName' | 'posSystem'> & { createdAt?: unknown },
  changes: {
    mode: 'product' | 'recipe' | 'skip'
    product?: Product | null
    recipe?: Recipe | null
    servingPreset?: string
    customMl?: string
  },
): { payload: Record<string, unknown>; createdAt: unknown } {
  const posItemName = existing.posItemName
  const posSystem = existing.posSystem ?? 'csv'
  const createdAt = (existing as any).createdAt ?? null

  if (changes.mode === 'skip') {
    return { payload: buildSavePayload(posItemName, posSystem, 'skipped', {}), createdAt }
  }
  if (changes.mode === 'recipe') {
    const r = changes.recipe ?? null
    return {
      payload: buildSavePayload(posItemName, posSystem, 'recipe', {
        recipeId: r?.id ?? null,
        recipeName: r?.name ?? null,
      }),
      createdAt,
    }
  }
  const p = changes.product ?? null
  if (!p) {
    return { payload: buildSavePayload(posItemName, posSystem, 'direct_product', {}), createdAt }
  }
  const sizeMl = productSizeInMl(p)
  const preset = changes.servingPreset ?? 'each'
  const customMlStr = changes.customMl ?? ''
  const serving = computeServingFields(preset, customMlStr, sizeMl)
  if ('skip' in serving) {
    return {
      payload: buildSavePayload(posItemName, posSystem, 'direct_product', {
        productId: p.id,
        productName: p.name,
      }),
      createdAt,
    }
  }
  return {
    payload: buildSavePayload(posItemName, posSystem, 'direct_product', {
      productId: p.id,
      productName: p.name,
      servingMl: serving.servingMl,
      conversionRatio: serving.conversionRatio,
      servingType: serving.servingType,
      conversionUnit: serving.conversionUnit,
    }),
    createdAt,
  }
}

export function buildBulkServingPayloads(
  selectedRows: NoServingRow[],
  products: Product[],
  servingPreset: string,
  customMl: string,
): Array<{ posName: string; docId: string; payload: Record<string, unknown> } | { posName: string; docId: string; skip: string }> {
  return selectedRows.map(row => {
    const dId = mappingDocId(row.posName, 'csv')
    const product = products.find(p => p.id === row.productId)
    if (!product) return { posName: row.posName, docId: dId, skip: 'product not found' }
    const sizeMl = productSizeInMl(product)
    const serving = computeServingFields(servingPreset, customMl, sizeMl)
    if ('skip' in serving) return { posName: row.posName, docId: dId, skip: serving.skip }
    return {
      posName: row.posName,
      docId: dId,
      payload: buildSavePayload(row.posName, 'csv', 'direct_product', {
        productId: product.id,
        productName: product.name,
        servingMl: serving.servingMl,
        conversionRatio: serving.conversionRatio,
        servingType: serving.servingType,
        conversionUnit: serving.conversionUnit,
      }),
    }
  })
}

export function buildBulkIgnorePayloads(
  posNames: string[],
): Array<{ posName: string; docId: string; payload: Record<string, unknown> }> {
  return posNames.map(posName => ({
    posName,
    docId: mappingDocId(posName, 'csv'),
    payload: buildSavePayload(posName, 'csv', 'skipped', {}),
  }))
}

export function unionReportIds(
  names: string[],
  activeReports: ActiveReport[],
): string[] {
  const normNames = new Set(names.map(n => wlNormName(n)))
  const ids = new Set<string>()
  for (const r of activeReports) {
    for (const l of r.rawLines) {
      if (normNames.has(wlNormName(l.name ?? ''))) {
        ids.add(r.id)
        break
      }
    }
  }
  return [...ids]
}

export function allMappingsRows(
  mappings: Mapping[],
  products: Product[],
  recipes: Recipe[],
  activeReports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
  versionsDataArg: Record<string, MappingVersionData[]> = {},
): AllMappingRow[] {
  const productById = new Map(products.map(p => [p.id, p]))
  const recipeById  = new Map(recipes.map(r => [r.id, r]))

  const groups = new Map<string, Mapping[]>()
  for (const m of mappings) {
    const key = (m.posItemName || '').toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(m)
  }

  const rows: AllMappingRow[] = []

  for (const [, group] of groups) {
    const m = group.reduce((a, b) => toTimestamp(b.updatedAt) > toTimestamp(a.updatedAt) ? b : a)
    const docCount = group.length
    const warningDuplicate = docCount > 1
    const allMappingIds = group.map(g => g.id)

    let targetLabel = '—'
    let warningMergedOrMissing = false

    if (m.mappingType === 'direct_product') {
      if (!m.productId) {
        targetLabel = '(missing product)'; warningMergedOrMissing = true
      } else {
        const p = productById.get(m.productId)
        if (!p) {
          targetLabel = '(missing product)'; warningMergedOrMissing = true
        } else if (p.mergedInto) {
          const survivor = productById.get(p.mergedInto)
          targetLabel = survivor
            ? `${p.name} → merged into ${survivor.name}`
            : `${p.name} → merged into (missing)`
          warningMergedOrMissing = true
        } else {
          targetLabel = p.name
        }
      }
    } else if (m.mappingType === 'recipe') {
      if (!m.recipeId) {
        targetLabel = '(missing recipe)'; warningMergedOrMissing = true
      } else {
        const r = recipeById.get(m.recipeId)
        if (r) { targetLabel = r.name }
        else { targetLabel = '(missing recipe)'; warningMergedOrMissing = true }
      }
    } else if (m.mappingType === 'skipped') {
      targetLabel = 'Ignored'
    }

    let servingLabel = '—'
    if (m.mappingType === 'direct_product') {
      if (m.servingType === 'each' || m.conversionUnit === 'each') {
        servingLabel = 'Each'
      } else if (m.servingType) {
        const preset = SERVING_PRESETS.find(p => p.type === m.servingType)
        servingLabel = preset ? preset.label : m.servingMl ? `${m.servingMl}ml` : '—'
      } else if (m.servingMl) {
        servingLabel = `${m.servingMl}ml`
      }
    }

    const warningNoServing = m.mappingType === 'direct_product'
      && !warningMergedOrMissing
      && m.servingType !== 'each'
      && m.conversionUnit !== 'each'
      && !(m.servingMl != null && m.servingMl > 0)
      && !(m.conversionRatio != null && m.conversionRatio > 0)

    const norm = wlNormName(m.posItemName ?? '')
    let seenInReports = 0
    let totalQtySold = 0
    for (const r of activeReports) {
      const inLines = r.rawLines.some(l => wlNormName(l.name ?? '') === norm)
      if (inLines) {
        seenInReports++
        const md = matchesByReport[r.id]
        if (md) {
          for (const match of md.matches) {
            if (wlNormName(match.name ?? '') === norm) totalQtySold += match.qtySold ?? 0
          }
        }
      }
    }

    const key = (m.posItemName || '').toLowerCase()
    const keyVersions = versionsDataArg[key] ?? []
    const versioned = keyVersions.length > 0
    const versionCount = keyVersions.length

    rows.push({ mapping: m, targetLabel, servingLabel, ratio: m.conversionRatio ?? null, seenInReports, totalQtySold, warningMergedOrMissing, warningNoServing, docCount, warningDuplicate, allMappingIds, versioned, versionCount })
  }

  return rows
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

// ── Mapping version types and pure helpers ────────────────────────────────────

export type MappingVersionData = {
  id: string
  mappingKey: string
  posItemName: string
  effectiveFrom: string // YYYY-MM-DD; '0000-01-01' = v0 sentinel
  mappingType: string | null
  productId: string | null
  productName: string | null
  recipeId: string | null
  recipeName: string | null
  servingMl: number | null
  conversionRatio: number | null
  servingType: string | null
  conversionUnit: string | null
  updatedByTrigger?: boolean
  createdByUid?: string
}

/**
 * Returns true when the "Fix a mistake" action is available.
 * Disabled once a key has any versions (use "Undo last change" instead).
 */
export function panelCanFixMistake(versions: MappingVersionData[]): boolean {
  return versions.length === 0
}

export function unlinkBlockedReason(
  versions: MappingVersionData[],
  versionsLoadError: boolean,
): string | null {
  if (versionsLoadError) return 'Version history unavailable — cannot confirm safe to unlink.'
  if (versions.length > 0) return 'This button has dated product changes — undo them first.'
  return null
}

export function saveMappingBlockedReason(
  isExistingMapping: boolean,
  versions: MappingVersionData[],
  versionsLoadError: boolean,
): string | null {
  if (!isExistingMapping) return null
  if (!panelCanFixMistake(versions)) {
    return 'Fix a mistake is disabled — this key has version history. Use Undo last change to revert.'
  }
  if (versionsLoadError) return 'Version history unavailable — cannot confirm safe to edit.'
  return null
}

const API_BASE = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api'

export type StraddleDecision = {
  reportId: string
  period: string | null
  mappingKey: string
  versionIds: string[]
  chosenVersionId: string
}

export function buildChangeProductBody(
  posItemName: string,
  effectiveFrom: string,
  product: Product,
  servingPreset: string,
  customMl: string,
): { posItemName: string; effectiveFrom: string; newFields: Record<string, unknown> } {
  const szMl = productSizeInMl(product)
  const serving = computeServingFields(servingPreset, customMl, szMl)
  const newFields: Record<string, unknown> = {
    mappingType: 'direct_product',
    productId: product.id,
    productName: product.name,
    recipeId: null,
    recipeName: null,
    servingMl: 'skip' in serving ? null : serving.servingMl,
    conversionRatio: 'skip' in serving ? null : serving.conversionRatio,
    servingType: 'skip' in serving ? null : serving.servingType,
    conversionUnit: 'skip' in serving ? null : serving.conversionUnit,
  }
  return { posItemName, effectiveFrom, newFields }
}

export function changeProductPreview(
  effectiveFrom: string,
  oldProductName: string | null,
  newProductName: string,
): string {
  if (!effectiveFrom) return ''
  const [y, m, d] = effectiveFrom.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const fmt = date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  const old = oldProductName ?? 'old product'
  return `Sales before ${fmt} stay with ${old}. Sales from ${fmt} go to ${newProductName}.`
}

export function firstDeliveryDate(
  lines: Array<{ date: string | null; productId: string | null }>,
  productId: string,
): string | null {
  const matches = lines
    .filter(l => l.productId === productId && l.date)
    .map(l => l.date!)
    .sort()
  return matches[0] ?? null
}

export function undoConfirmText(versions: MappingVersionData[]): string {
  const real = versions.filter(v => v.effectiveFrom !== '0000-01-01')
  if (real.length < 2) {
    const prev = versions.find(v => v.effectiveFrom === '0000-01-01')
    const prevName = prev?.productName ?? prev?.recipeName ?? 'previous product'
    return `Restore ${prevName} for all dates?`
  }
  const prev = real[real.length - 2]
  const prevName = prev.productName ?? prev.recipeName ?? 'previous product'
  return `Restore ${prevName} for all dates?`
}

export function undoConfirmTextFromChange(
  change: { kind: string; before: Record<string, unknown> | null } | null,
  versions: MappingVersionData[],
): string {
  if (!change) return undoConfirmText(versions)
  if (change.kind === 'link') return 'Remove this link?'
  const prevName = (change.before as any)?.productName ?? (change.before as any)?.recipeName ?? 'previous'
  return `Restore ${prevName} for this button?`
}

export function buildStraddleDecisions(
  matchesByReport: Record<string, MatchData | null>,
  activeReports: ActiveReport[],
): StraddleDecision[] {
  const decisions: StraddleDecision[] = []
  for (const r of activeReports) {
    const md = matchesByReport[r.id]
    if (!md) continue
    const seenKeys = new Set<string>()
    for (const match of md.matches) {
      const straddle = (match as any).mappingStraddle
      if (!straddle?.defaulted) continue
      const key = (match.name ?? '').toLowerCase()
      if (!key || seenKeys.has(key)) continue
      seenKeys.add(key)
      decisions.push({
        reportId: r.id,
        period: r.startStr && r.endStr ? `${r.startStr} – ${r.endStr}` : r.startStr ?? null,
        mappingKey: key,
        versionIds: straddle.versionIds ?? [],
        chosenVersionId: straddle.chosenVersionId ?? '',
      })
    }
  }
  return decisions
}

function _formatVersionDate(dateStr: string): string {
  if (dateStr === '0000-01-01') return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

/**
 * Returns a human-readable timeline label for the most recent version change.
 * e.g. "Andre Clouet → Champagne Collet from 7 Oct"
 * Returns '' when fewer than 2 versions.
 */
export function versionTimelineLabel(versions: MappingVersionData[]): string {
  // Filter out v0 sentinel and get real versions
  const real = versions.filter(v => v.effectiveFrom !== '0000-01-01')
  if (real.length === 0) return ''
  const latest = real[real.length - 1]
  const prevAll = versions.filter(v => v.effectiveFrom < latest.effectiveFrom)
  const prev = prevAll.length > 0 ? prevAll[prevAll.length - 1] : null
  const prevLabel = prev
    ? (prev.productName ?? prev.recipeName ?? prev.mappingType ?? '?')
    : '?'
  const nextLabel = latest.productName ?? latest.recipeName ?? latest.mappingType ?? '?'
  const fromDate  = _formatVersionDate(latest.effectiveFrom)
  return `${prevLabel} → ${nextLabel} from ${fromDate}`
}

function toTimestamp(val: unknown): number {
  if (val == null) return 0
  if (typeof val === 'number') return val
  if (val instanceof Date) return val.getTime()
  if (typeof val === 'object' && val !== null) {
    if ('toMillis' in val) return (val as any).toMillis()
    if ('seconds' in val) return (val as any).seconds * 1000
  }
  return 0
}

export type WriteOp =
  | { kind: 'set'; docId: string; payload: Record<string, unknown>; existingCreatedAt: unknown | null; posName: string }
  | { kind: 'delete'; docId: string }

export function planMappingWrites(
  entries: Array<{ posName: string; payload: Record<string, unknown> }>,
  existingMappings: Mapping[],
): WriteOp[][] {
  const entryOps: WriteOp[][] = []

  for (const entry of entries) {
    const key = (entry.posName || '').toLowerCase()
    const group = existingMappings.filter(m => (m.posItemName || '').toLowerCase() === key)
    const ops: WriteOp[] = []

    if (group.length === 0) {
      ops.push({ kind: 'set', docId: mappingDocId(entry.posName, 'csv'), payload: entry.payload, existingCreatedAt: null, posName: entry.posName })
    } else {
      const preferred = group.find(m => m.id === mappingDocId(entry.posName, m.posSystem || 'csv'))
      const canonical = preferred ?? group.reduce((a, b) => toTimestamp(b.updatedAt) > toTimestamp(a.updatedAt) ? b : a)
      const posSystem = canonical.posSystem || 'csv'
      const existingCreatedAt = group.reduce<unknown>((earliest, m) => {
        if (earliest === null) return m.createdAt ?? null
        return toTimestamp(m.createdAt) < toTimestamp(earliest) ? m.createdAt ?? null : earliest
      }, null)
      const finalPayload = { ...entry.payload, posSystem }
      ops.push({ kind: 'set', docId: canonical.id, payload: finalPayload, existingCreatedAt, posName: entry.posName })
      for (const m of group) {
        if (m.id !== canonical.id) ops.push({ kind: 'delete', docId: m.id })
      }
    }

    entryOps.push(ops)
  }

  const batches: WriteOp[][] = []
  let currentBatch: WriteOp[] = []
  for (const ops of entryOps) {
    if (currentBatch.length > 0 && currentBatch.length + ops.length > 400) {
      batches.push(currentBatch)
      currentBatch = []
    }
    currentBatch.push(...ops)
  }
  if (currentBatch.length > 0) batches.push(currentBatch)

  return batches
}

export function planUnlinkWrites(
  posName: string,
  existingMappings: Mapping[],
): WriteOp[][] {
  const key = (posName || '').toLowerCase()
  const group = existingMappings.filter(m => (m.posItemName || '').toLowerCase() === key)
  if (group.length === 0) return []
  return [group.map(m => ({ kind: 'delete' as const, docId: m.id }))]
}

export async function rematchReports(
  venueId: string,
  reportIds: string[],
  token: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ errors: string[] }> {
  const errors: string[] = []
  for (let i = 0; i < reportIds.length; i++) {
    try {
      const res = await fetch(
        'https://us-central1-tallyup-f1463.cloudfunctions.net/api/match-sales-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ venueId, reportId: reportIds[i] }),
        },
      )
      if (!res.ok) errors.push(`Report ${reportIds[i]}: HTTP ${res.status}`)
    } catch (e: any) {
      errors.push(`Report ${reportIds[i]}: ${e?.message ?? 'network error'}`)
    }
    onProgress(i + 1, reportIds.length)
  }
  return { errors }
}

// ── Mapping panel ─────────────────────────────────────────────────────────────

function initPanelState(
  existingMapping: Mapping | null,
  products: Product[],
  recipes: Recipe[],
) {
  if (!existingMapping) {
    return { mode: 'product' as const, selectedProduct: null as Product | null, servingPreset: 'each', customMl: '', selectedRecipe: null as Recipe | null }
  }
  if (existingMapping.mappingType === 'skipped') {
    return { mode: 'skip' as const, selectedProduct: null as Product | null, servingPreset: 'each', customMl: '', selectedRecipe: null as Recipe | null }
  }
  if (existingMapping.mappingType === 'recipe') {
    const recipe = recipes.find(r => r.id === existingMapping.recipeId) ?? null
    return { mode: 'recipe' as const, selectedProduct: null as Product | null, servingPreset: 'each', customMl: '', selectedRecipe: recipe }
  }
  const product = products.find(p => p.id === existingMapping.productId) ?? null
  let servingPreset = 'each'
  let customMl = ''
  if (existingMapping.servingType) {
    servingPreset = existingMapping.servingType
    if (existingMapping.servingType === 'custom') customMl = String(existingMapping.servingMl ?? '')
  } else if (existingMapping.conversionUnit === 'each') {
    servingPreset = 'each'
  } else if (existingMapping.servingMl && existingMapping.servingMl > 0) {
    servingPreset = 'custom'
    customMl = String(existingMapping.servingMl)
  }
  return { mode: 'product' as const, selectedProduct: product, servingPreset, customMl, selectedRecipe: null as Recipe | null }
}

function MappingPanel({
  posName,
  preselectedProduct,
  existingMapping,
  affectedReports,
  versions,
  versionsUnavailable,
  products,
  recipes,
  saving,
  venueId,
  canManage,
  onSave,
  onClose,
  onUnlink,
  onVersionReload,
}: {
  posName: string
  preselectedProduct?: { id: string; name: string } | null
  existingMapping?: Mapping | null
  affectedReports?: { count: number; dateRange: string | null } | null
  versions?: MappingVersionData[]
  versionsUnavailable?: boolean
  products: Product[]
  recipes: Recipe[]
  saving: boolean
  venueId: string
  canManage: boolean
  onSave: (payload: Record<string, unknown>, posName: string, existingCreatedAt?: unknown, kind?: 'link' | 'fix') => void
  onClose: () => void
  onUnlink?: () => void
  onVersionReload: () => Promise<void>
}) {
  const keyVersions = versions ?? []
  const isVersioned = keyVersions.length > 0
  const timelineLabel = versionTimelineLabel(keyVersions)
  const latestVersion = isVersioned ? keyVersions[keyVersions.length - 1] : null
  const editedOutsideWebApp = latestVersion?.updatedByTrigger === true

  const init = initPanelState(existingMapping ?? null, products, recipes)
  const [mode, setMode]               = useState<'product' | 'recipe' | 'skip'>(
    preselectedProduct && !existingMapping ? 'product' : init.mode
  )
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(
    existingMapping ? init.selectedProduct
      : preselectedProduct ? products.find(p => p.id === preselectedProduct.id) ?? null
      : null
  )
  const [servingPreset, setServingPreset] = useState<string>(init.servingPreset)
  const [customMl, setCustomMl]       = useState(init.customMl)
  const [recipeSearch, setRecipeSearch] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(init.selectedRecipe)
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)

  // Two-choice gate: null = not chosen, 'fix-mistake' = existing editor, 'change-product' = new sub-form
  const [editMode, setEditMode] = useState<'fix-mistake' | 'change-product' | null>(
    existingMapping ? null : 'fix-mistake'
  )

  // Change-product sub-form state
  const [cpProductSearch, setCpProductSearch] = useState('')
  const [cpProduct, setCpProduct] = useState<Product | null>(null)
  const [cpServingPreset, setCpServingPreset] = useState('each')
  const [cpCustomMl, setCpCustomMl] = useState('')
  const [cpDate, setCpDate] = useState('')
  const [cpSuggestion, setCpSuggestion] = useState<string | null>(null)
  const [cpSubmitting, setCpSubmitting] = useState(false)
  const [cpError, setCpError] = useState<string | null>(null)

  // Undo state
  const [undoConfirm, setUndoConfirm] = useState(false)
  const [undoSubmitting, setUndoSubmitting] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  // Change log for this key (loaded from server)
  const [changeLog, setChangeLog] = useState<Array<{ id: string; kind: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: { toDate?: () => Date } | null; undone: boolean }>>([])
  useEffect(() => {
    if (!posName) return
    const mappingKey = posName.toLowerCase()
    let cancelled = false
    async function loadLog() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) return
        const resp = await fetch(`${API_BASE}/pos-mappings/changes?venueId=${encodeURIComponent(venueId)}&mappingKey=${encodeURIComponent(mappingKey)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!resp.ok) return
        const json = await resp.json()
        if (!cancelled && json.ok) setChangeLog(json.changes ?? [])
      } catch { /* non-critical */ }
    }
    loadLog()
    return () => { cancelled = true }
  }, [posName, venueId])

  const hasAnyHistory = isVersioned || changeLog.length > 0
  const latestChange = changeLog.find(c => !c.undone) ?? null

  function undoConfirmTextForChange(): string {
    return undoConfirmTextFromChange(latestChange, keyVersions)
  }

  function formatChangeDate(at: { toDate?: () => Date } | null): string {
    if (!at?.toDate) return ''
    const d = at.toDate()
    const now = new Date()
    const sameYear = d.getFullYear() === now.getFullYear()
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' })
  }

  function changeLogLabel(c: { kind: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: { toDate?: () => Date } | null }): string {
    const date = formatChangeDate(c.at)
    const name = (c.after as any)?.productName ?? (c.after as any)?.recipeName ?? null
    const prevName = (c.before as any)?.productName ?? (c.before as any)?.recipeName ?? null
    const effectiveFrom = (c as any)?.versionId ? '' : ''
    switch (c.kind) {
      case 'link': return `Linked to ${name ?? 'Ignored'}${date ? ` · ${date}` : ''}`
      case 'fix': return `Fixed to ${name ?? 'Ignored'}${date ? ` · ${date}` : ''}`
      case 'unlink': return `Unlinked${prevName ? ` from ${prevName}` : ''}${date ? ` · ${date}` : ''}`
      case 'dated_change': return `Changed to ${name ?? '?'}${effectiveFrom ? ` from ${effectiveFrom}` : ''}${date ? ` · ${date}` : ''}`
      default: return `Change${date ? ` · ${date}` : ''}`
    }
  }

  const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase()
    return q ? products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 12) : []
  }, [products, productSearch])

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.toLowerCase()
    return q ? recipes.filter(r => r.name.toLowerCase().includes(q)).slice(0, 12) : []
  }, [recipes, recipeSearch])

  const cpFilteredProducts = useMemo(() => {
    const q = cpProductSearch.toLowerCase()
    return q ? products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 12) : []
  }, [products, cpProductSearch])

  useEffect(() => {
    if (!cpProduct) { setCpSuggestion(null); return }
    let cancelled = false
    async function load() {
      try {
        const snap = await getDocs(collection(db, 'venues', venueId, 'invoices'))
        const lines: Array<{ date: string | null; productId: string | null }> = []
        snap.docs.forEach(d => {
          const data = d.data() as any
          const ts = data.invoiceDateTimestamp ?? data.date ?? data.createdAt
          const dateStr: string | null = ts?.toDate
            ? ts.toDate().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
            : null
          const rawLines = Array.isArray(data.lines) ? data.lines : []
          rawLines.forEach((l: any) => {
            lines.push({ date: dateStr, productId: l.productId ?? null })
          })
        })
        let earliest = firstDeliveryDate(lines, cpProduct!.id)
        // Fallback: collectionGroup query on invoice lines subcollection
        if (!earliest) {
          try {
            const lineSnap = await getDocs(query(collectionGroup(db, 'lines'), where('productId', '==', cpProduct!.id)))
            const subcollLines: Array<{ date: string | null; productId: string | null }> = []
            await Promise.all(lineSnap.docs.slice(0, 20).map(async ld => {
              try {
                const invoiceRef = ld.ref.parent.parent
                if (!invoiceRef) return
                const invSnap = await getDoc(invoiceRef)
                if (!invSnap.exists()) return
                const invData = invSnap.data() as any
                const ts2 = invData.invoiceDateTimestamp ?? invData.date ?? invData.createdAt
                const dateStr2: string | null = ts2?.toDate
                  ? ts2.toDate().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
                  : null
                subcollLines.push({ date: dateStr2, productId: cpProduct!.id })
              } catch { /* skip */ }
            }))
            earliest = firstDeliveryDate(subcollLines, cpProduct!.id)
          } catch { /* collectionGroup may not have index */ }
        }
        if (!cancelled) setCpSuggestion(earliest)
      } catch {
        if (!cancelled) setCpSuggestion(null)
      }
    }
    load()
    return () => { cancelled = true }
  }, [cpProduct, venueId])

  const cpSizeMl = cpProduct ? productSizeInMl(cpProduct) : null
  const cpServingMl: number | null = useMemo(() => {
    if (cpServingPreset === 'each' || !cpProduct) return null
    if (cpServingPreset === 'full_bottle') return cpSizeMl
    const preset = SERVING_PRESETS.find(p => p.type === cpServingPreset)
    if (preset?.ml != null) return preset.ml
    if (cpServingPreset === 'custom') {
      const v = parseFloat(cpCustomMl); return isNaN(v) || v <= 0 ? null : v
    }
    return null
  }, [cpServingPreset, cpSizeMl, cpCustomMl, cpProduct])

  const cpCanSave = !!cpProduct && !!cpDate && (cpServingPreset === 'each' || cpServingMl != null)

  const cpPreview = useMemo(() => {
    if (!cpProduct || !cpDate) return null
    const oldName = existingMapping?.productName ?? existingMapping?.recipeName ?? null
    return changeProductPreview(cpDate, oldName, cpProduct.name)
  }, [cpProduct, cpDate, existingMapping])

  async function handleChangeProductSave() {
    if (!canManage || !cpProduct || !cpDate || cpSubmitting) return
    setCpSubmitting(true)
    setCpError(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setCpError('Not authenticated'); setCpSubmitting(false); return }
      const body = buildChangeProductBody(posName, cpDate, cpProduct, cpServingPreset, cpCustomMl)
      const resp = await fetch(`${API_BASE}/pos-mappings/change-product`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, ...body }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) { setCpError(json.error ?? 'Change failed'); setCpSubmitting(false); return }
      await onVersionReload()
      onClose()
    } catch (e: any) {
      setCpError(e?.message ?? 'Change failed')
      setCpSubmitting(false)
    }
  }

  async function handleUndoConfirm() {
    if (!canManage || undoSubmitting) return
    setUndoSubmitting(true)
    setUndoError(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setUndoError('Not authenticated'); setUndoSubmitting(false); return }
      const resp = await fetch(`${API_BASE}/pos-mappings/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, posItemName: posName }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) { setUndoError(json.error ?? 'Undo failed'); setUndoSubmitting(false); return }
      await onVersionReload()
      onClose()
    } catch (e: any) {
      setUndoError(e?.message ?? 'Undo failed')
      setUndoSubmitting(false)
    }
  }

  const sizeMl = selectedProduct ? productSizeInMl(selectedProduct) : null
  const servingMl: number | null = useMemo(() => {
    if (servingPreset === 'each' || mode !== 'product' || !selectedProduct) return null
    if (servingPreset === 'full_bottle') return sizeMl
    const preset = SERVING_PRESETS.find(p => p.type === servingPreset)
    if (preset?.ml != null) return preset.ml
    if (servingPreset === 'custom') {
      const v = parseFloat(customMl)
      return isNaN(v) || v <= 0 ? null : v
    }
    return null
  }, [servingPreset, sizeMl, customMl, mode, selectedProduct])

  const previewText = useMemo(() => {
    if (mode !== 'product' || !selectedProduct) return null
    if (servingPreset === 'each') return '1 sale = 1 stock unit (each)'
    if (servingMl == null) return null
    if (sizeMl == null) return `1 sale uses ${servingMl}ml (product size unknown — ratio will use legacy conversion)`
    return servingPreviewText(servingMl, sizeMl)
  }, [mode, selectedProduct, servingPreset, servingMl, sizeMl])

  function handleSave() {
    const kind = existingMapping ? 'fix' : 'link'
    if (existingMapping) {
      const { payload, createdAt } = buildEditPayload(existingMapping, {
        mode, product: selectedProduct, recipe: selectedRecipe, servingPreset, customMl,
      })
      onSave(payload, posName, createdAt, kind)
      return
    }
    if (mode === 'skip') {
      onSave(buildSavePayload(posName, 'csv', 'skipped', {}), posName, undefined, kind)
      return
    }
    if (mode === 'recipe') {
      if (!selectedRecipe) return
      onSave(buildSavePayload(posName, 'csv', 'recipe', { recipeId: selectedRecipe.id, recipeName: selectedRecipe.name }), posName, undefined, kind)
      return
    }
    if (!selectedProduct) return
    const szMl = productSizeInMl(selectedProduct)
    const serving = computeServingFields(servingPreset, customMl, szMl)
    if ('skip' in serving) return
    onSave(buildSavePayload(posName, 'csv', 'direct_product', {
      productId:       selectedProduct.id,
      productName:     selectedProduct.name,
      servingMl:       serving.servingMl,
      conversionRatio: serving.conversionRatio,
      servingType:     serving.servingType,
      conversionUnit:  serving.conversionUnit,
    }), posName, undefined, kind)
  }

  const saveBlockedReason = saveMappingBlockedReason(!!existingMapping, keyVersions, versionsUnavailable ?? false)

  const canSave = !saveBlockedReason && (
    mode === 'skip'
    || (mode === 'recipe' && !!selectedRecipe)
    || (mode === 'product' && !!selectedProduct && (servingPreset === 'each' || servingMl != null))
  )

  // Serving label for current mapping
  const currentServingLabel = (() => {
    if (!existingMapping) return null
    if (existingMapping.mappingType === 'skipped') return 'Ignored'
    if (existingMapping.mappingType === 'recipe') return existingMapping.recipeName ?? null
    const pName = existingMapping.productName ?? null
    const sType = existingMapping.servingType ?? (existingMapping.conversionUnit === 'each' ? 'each' : null)
    if (!pName) return null
    const sLabel = sType === 'each' ? 'each' : existingMapping.servingMl ? `${existingMapping.servingMl}ml` : null
    return sLabel ? `${pName}, ${sLabel}` : pName
  })()

  return (
    <div className={styles.drawerOverlay} onClick={() => { if (!saving && !cpSubmitting && !undoSubmitting) onClose() }}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div>
          <button className={styles.drawerClose} onClick={() => { if (!saving && !cpSubmitting && !undoSubmitting) onClose() }}>×</button>
          <p className={styles.drawerTitle}>Till button: {posName}</p>
          {existingMapping
            ? <p className={styles.drawerSubtitle}>Currently: {currentServingLabel ?? '—'}</p>
            : <p className={styles.drawerSubtitle}>Not linked yet</p>
          }
        </div>

        {affectedReports && affectedReports.count > 0 && editMode === 'fix-mistake' && (
          <div className={`${styles.banner} ${styles.bannerAmber}`}>
            <strong style={{ color: '#b45309' }}>Changes all past sales history — affects {affectedReports.count} report{affectedReports.count !== 1 ? 's' : ''}.</strong>
            {affectedReports.dateRange ? ` (${affectedReports.dateRange})` : ''}
          </div>
        )}

        {!existingMapping && affectedReports && affectedReports.count > 0 && (
          <div className={`${styles.banner} ${styles.bannerGray}`} style={{ fontSize: 12 }}>
            This also applies to {affectedReports.count} past report{affectedReports.count !== 1 ? 's' : ''} where this button appeared.
          </div>
        )}

        {timelineLabel && (
          <div className={`${styles.banner} ${styles.bannerGray}`} style={{ fontSize: 12 }}>
            {timelineLabel}
            {editedOutsideWebApp && (
              <span style={{ marginLeft: 8, color: '#92400e' }}>· Edited outside the web app</span>
            )}
          </div>
        )}

        {/* Two-choice gate for existing mappings */}
        {existingMapping && editMode === null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>What would you like to do?</p>
            <button
              className={styles.btnSecondary}
              style={{ textAlign: 'left' }}
              disabled={!!saveBlockedReason}
              onClick={() => setEditMode('fix-mistake')}
            >
              <strong>Fix a mistake</strong>
              <span style={{ fontSize: 12, color: '#6b7280', display: 'block' }}>It was set up wrong from the start.</span>
              {affectedReports && affectedReports.count > 0 && (
                <span style={{ fontSize: 12, color: '#dc2626', display: 'block', marginTop: 2 }}>
                  Changes all past sales history — affects {affectedReports.count} report{affectedReports.count !== 1 ? 's' : ''}.
                </span>
              )}
            </button>
            {saveBlockedReason && (
              <p className={styles.errorText} style={{ fontSize: 12, marginTop: 0 }}>{saveBlockedReason}</p>
            )}
            <button
              className={styles.btnSecondary}
              style={{ textAlign: 'left' }}
              disabled={!canManage}
              onClick={() => setEditMode('change-product')}
            >
              <strong>Change from a date</strong>
              <span style={{ fontSize: 12, color: '#6b7280', display: 'block' }}>It now pours something different — a new product or a new pour size. Sales before that date stay as they were.</span>
            </button>
          </div>
        )}

        {/* Fix a mistake mode — existing form */}
        {editMode === 'fix-mistake' && (
          <>
            {existingMapping && (
              <button className={styles.btnSecondary} style={{ marginBottom: 4 }} onClick={() => setEditMode(null)}>← Back</button>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {([
                { key: 'product', label: 'Product', desc: 'One bottle, keg or item from your shelf.' },
                { key: 'recipe', label: 'Recipe', desc: 'A drink made from set amounts of several products.' },
                { key: 'skip', label: 'Ignore', desc: 'Not stock — food, fees, service charges.' },
              ] as const).map(({ key: m, label, desc }) => (
                <button
                  key={m}
                  className={styles.btnSecondary}
                  style={{ textAlign: 'left', background: mode === m ? '#eff6ff' : undefined, borderColor: mode === m ? '#3b82f6' : undefined }}
                  onClick={() => setMode(m)}
                >
                  <strong style={{ color: mode === m ? '#1d4ed8' : undefined }}>{label}</strong>
                  <span style={{ fontSize: 12, color: '#6b7280', display: 'block' }}>{desc}</span>
                </button>
              ))}
            </div>

            {mode === 'product' && (
              <>
                <div className={styles.drawerSection}>
                  <p className={styles.drawerSectionTitle}>Product</p>
                  {selectedProduct
                    ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <span style={{ flex: 1, fontWeight: 600, color: '#1a2332' }}>{selectedProduct.name}</span>
                        <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={() => { setSelectedProduct(null); setProductSearch('') }}>Change</button>
                      </div>
                    )
                    : (
                      <>
                        <input
                          className={styles.searchInput}
                          placeholder="Search products…"
                          value={productSearch}
                          onChange={e => setProductSearch(e.target.value)}
                          autoFocus
                        />
                        {filteredProducts.length > 0 && (
                          <div className={styles.searchResults}>
                            {filteredProducts.map(p => (
                              <div
                                key={p.id}
                                className={styles.searchResultItem}
                                onClick={() => { setSelectedProduct(p); setProductSearch('') }}
                              >
                                {p.name}
                                {p.size && p.unit && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 6 }}>{p.size}{p.unit}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )
                  }
                </div>

                {selectedProduct && (
                  <div className={styles.drawerSection}>
                    <p className={styles.drawerSectionTitle}>Serving size</p>
                    <div className={styles.servingTypeTabs}>
                      {SERVING_PRESETS.map(p => (
                        <button
                          key={p.type}
                          className={`${styles.servingTypeBtn} ${servingPreset === p.type ? styles.servingTypeBtnActive : ''}`}
                          onClick={() => setServingPreset(p.type)}
                        >
                          {p.label}
                        </button>
                      ))}
                      {sizeMl != null && (
                        <button
                          className={`${styles.servingTypeBtn} ${servingPreset === 'full_bottle' ? styles.servingTypeBtnActive : ''}`}
                          onClick={() => setServingPreset('full_bottle')}
                        >
                          Full bottle ({sizeMl}ml)
                        </button>
                      )}
                    </div>
                    {servingPreset === 'custom' && (
                      <input
                        className={styles.searchInput}
                        style={{ marginTop: 8, width: 120 }}
                        type="number"
                        min="0"
                        placeholder="ml e.g. 200"
                        value={customMl}
                        onChange={e => setCustomMl(e.target.value)}
                      />
                    )}
                    {previewText && (
                      <p className={styles.previewText} style={{ marginTop: 8 }}>{previewText}</p>
                    )}
                  </div>
                )}
              </>
            )}

            {mode === 'recipe' && (
              <div className={styles.drawerSection}>
                <p className={styles.drawerSectionTitle}>Recipe</p>
                {selectedRecipe
                  ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <span style={{ flex: 1, fontWeight: 600, color: '#1a2332' }}>{selectedRecipe.name}</span>
                      <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={() => { setSelectedRecipe(null); setRecipeSearch('') }}>Change</button>
                    </div>
                  )
                  : (
                    <>
                      <input
                        className={styles.searchInput}
                        placeholder="Search recipes…"
                        value={recipeSearch}
                        onChange={e => setRecipeSearch(e.target.value)}
                        autoFocus
                      />
                      {filteredRecipes.length > 0 && (
                        <div className={styles.searchResults}>
                          {filteredRecipes.map(r => (
                            <div
                              key={r.id}
                              className={styles.searchResultItem}
                              onClick={() => { setSelectedRecipe(r); setRecipeSearch('') }}
                            >
                              {r.name}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )
                }
              </div>
            )}

            {mode === 'skip' && (
              <p style={{ fontSize: 13, color: '#6b7280' }}>
                This POS name will be ignored in future match runs and won't appear in unmatched lists.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8, flexWrap: 'wrap' }}>
              <button className={styles.btnSecondary} onClick={() => { if (!saving) onClose() }}>Cancel</button>
              <button className={styles.btnPrimary} disabled={!canSave || saving} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save mapping'}
              </button>
              {existingMapping && onUnlink && !unlinkConfirm && (() => {
                const blocked = unlinkBlockedReason(keyVersions, versionsUnavailable ?? false)
                return blocked
                  ? <p className={styles.errorText} style={{ marginLeft: 'auto', marginTop: 0, fontSize: 12 }}>{blocked}</p>
                  : <button className={styles.btnDanger} style={{ marginLeft: 'auto' }} onClick={() => setUnlinkConfirm(true)}>Unlink</button>
              })()}
              {unlinkConfirm && (
                <div style={{ width: '100%', fontSize: 13, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 12px' }}>
                  Delete this mapping and re-match affected reports?
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className={styles.btnDanger} onClick={onUnlink}>Delete</button>
                    <button className={styles.btnSecondary} onClick={() => setUnlinkConfirm(false)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Change-product sub-form */}
        {editMode === 'change-product' && (
          <>
            <button className={styles.btnSecondary} style={{ marginBottom: 4 }} onClick={() => setEditMode(null)}>← Back</button>

            <div className={styles.drawerSection}>
              <p className={styles.drawerSectionTitle}>New product from date</p>
              {cpProduct ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{cpProduct.name}</span>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={() => { setCpProduct(null); setCpProductSearch('') }}>Change</button>
                </div>
              ) : (
                <>
                  <input className={styles.searchInput} placeholder="Search products…" value={cpProductSearch} onChange={e => setCpProductSearch(e.target.value)} autoFocus />
                  {cpFilteredProducts.length > 0 && (
                    <div className={styles.searchResults}>
                      {cpFilteredProducts.map(p => (
                        <div key={p.id} className={styles.searchResultItem} onClick={() => { setCpProduct(p); setCpProductSearch('') }}>
                          {p.name}
                          {p.size && p.unit && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 6 }}>{p.size}{p.unit}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {cpProduct && (
              <div className={styles.drawerSection}>
                <p className={styles.drawerSectionTitle}>Serving size</p>
                <div className={styles.servingTypeTabs}>
                  {SERVING_PRESETS.map(p => (
                    <button key={p.type} className={`${styles.servingTypeBtn} ${cpServingPreset === p.type ? styles.servingTypeBtnActive : ''}`} onClick={() => setCpServingPreset(p.type)}>
                      {p.label}
                    </button>
                  ))}
                  {cpSizeMl != null && (
                    <button className={`${styles.servingTypeBtn} ${cpServingPreset === 'full_bottle' ? styles.servingTypeBtnActive : ''}`} onClick={() => setCpServingPreset('full_bottle')}>
                      Full bottle ({cpSizeMl}ml)
                    </button>
                  )}
                </div>
                {cpServingPreset === 'custom' && (
                  <input className={styles.searchInput} style={{ marginTop: 8, width: 120 }} type="number" min="0" placeholder="ml e.g. 200" value={cpCustomMl} onChange={e => setCpCustomMl(e.target.value)} />
                )}
              </div>
            )}

            <div className={styles.drawerSection}>
              <p className={styles.drawerSectionTitle}>Effective from (date of first sale under new product)</p>
              <input
                type="date"
                max={todayNZ}
                value={cpDate}
                onChange={e => setCpDate(e.target.value)}
                className={styles.searchInput}
                style={{ width: 160 }}
              />
              {cpSuggestion && cpSuggestion !== cpDate && (
                <p style={{ fontSize: 12, color: '#2563eb', marginTop: 6, cursor: 'pointer' }} onClick={() => setCpDate(cpSuggestion!)}>
                  First delivery of {cpProduct?.name}: {cpSuggestion} — click to use
                </p>
              )}
            </div>

            {cpPreview && (
              <p className={styles.previewText}>{cpPreview}</p>
            )}

            {cpError && <p className={styles.errorText}>{cpError}</p>}

            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
              <button className={styles.btnSecondary} onClick={() => { if (!cpSubmitting) onClose() }}>Cancel</button>
              <button className={styles.btnPrimary} disabled={!cpCanSave || cpSubmitting} onClick={handleChangeProductSave}>
                {cpSubmitting ? 'Saving…' : 'Save change'}
              </button>
            </div>
          </>
        )}

        {/* Undo last change — shown when any history exists */}
        {hasAnyHistory && canManage && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 8 }}>
            {!undoConfirm ? (
              <button className={styles.btnSecondary} onClick={() => setUndoConfirm(true)}>
                Undo last change
              </button>
            ) : (
              <div style={{ fontSize: 13 }}>
                <p style={{ marginBottom: 8 }}>{undoConfirmTextForChange()}</p>
                {undoError && <p className={styles.errorText}>{undoError}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={styles.btnDanger} disabled={undoSubmitting} onClick={handleUndoConfirm}>
                    {undoSubmitting ? 'Restoring…' : 'Yes, restore'}
                  </button>
                  <button className={styles.btnSecondary} onClick={() => { setUndoConfirm(false); setUndoError(null) }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timeline — change log entries, newest first (B6) */}
        {changeLog.length > 0 && (
          <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 10, marginTop: 6 }}>
            <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>History</p>
            {changeLog.map(c => (
              <p key={c.id} style={{ fontSize: 12, color: c.undone ? '#d1d5db' : '#6b7280', margin: '2px 0', textDecoration: c.undone ? 'line-through' : undefined }}>
                {changeLogLabel(c)}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Bulk serving panel ────────────────────────────────────────────────────────

function BulkServingPanel({
  selectedRows,
  products,
  saving,
  onSave,
  onClose,
}: {
  selectedRows: NoServingRow[]
  products: Product[]
  saving: boolean
  onSave: (preset: string, customMl: string) => void
  onClose: () => void
}) {
  const [servingPreset, setServingPreset] = useState('each')
  const [customMl, setCustomMl] = useState('')

  const summary = useMemo(() => {
    const results = buildBulkServingPayloads(selectedRows, products, servingPreset, customMl)
    const saves = results.filter((r): r is { posName: string; docId: string; payload: Record<string, unknown> } => !('skip' in r))
    const skipped = results.filter((r): r is { posName: string; docId: string; skip: string } => 'skip' in r)
    const noSize = saves.filter(s => {
      const row = selectedRows.find(r => r.posName === s.posName)
      if (!row) return false
      const product = products.find(p => p.id === row.productId)
      return product ? productSizeInMl(product) == null : false
    })
    const exampleSave = saves[0]
    const exampleRow = exampleSave ? selectedRows.find(r => r.posName === exampleSave.posName) : null
    const exampleProduct = exampleRow ? products.find(p => p.id === exampleRow.productId) : null
    const exampleSizeMl = exampleProduct ? productSizeInMl(exampleProduct) : null
    const servingMlVal = servingPreset === 'each' ? null
      : servingPreset === 'custom' ? (parseFloat(customMl) > 0 ? parseFloat(customMl) : null)
      : SERVING_PRESETS.find(p => p.type === servingPreset)?.ml ?? null
    const examplePreview = servingMlVal && exampleSizeMl
      ? servingPreviewText(servingMlVal, exampleSizeMl)
      : servingPreset === 'each' ? '1 sale = 1 stock unit (each)'
      : null
    return { saves, skipped, noSize, examplePreview }
  }, [selectedRows, products, servingPreset, customMl])

  return (
    <div className={styles.drawerOverlay} onClick={() => { if (!saving) onClose() }}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div>
          <button className={styles.drawerClose} onClick={() => { if (!saving) onClose() }}>×</button>
          <p className={styles.drawerTitle}>Set serving size</p>
          <p className={styles.drawerSubtitle}>{selectedRows.length} items selected</p>
        </div>

        <div className={styles.servingTypeTabs}>
          {SERVING_PRESETS.map(p => (
            <button
              key={p.type}
              className={`${styles.servingTypeBtn} ${servingPreset === p.type ? styles.servingTypeBtnActive : ''}`}
              onClick={() => setServingPreset(p.type)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {servingPreset === 'custom' && (
          <input
            className={styles.searchInput}
            style={{ width: 120 }}
            type="number"
            min="0"
            placeholder="ml e.g. 200"
            value={customMl}
            onChange={e => setCustomMl(e.target.value)}
          />
        )}

        <div className={styles.confirmPanel}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>
            {summary.saves.length} item{summary.saves.length !== 1 ? 's' : ''} will be saved
          </p>
          {summary.saves.slice(0, 5).map(s => (
            <div key={s.posName} style={{ fontSize: 12, color: '#374151' }}>{s.posName}</div>
          ))}
          {summary.saves.length > 5 && <div style={{ fontSize: 12, color: '#9ca3af' }}>+{summary.saves.length - 5} more…</div>}
          {summary.examplePreview && (
            <p className={styles.previewText} style={{ marginTop: 8 }}>{summary.examplePreview}</p>
          )}
          {summary.noSize.length > 0 && servingPreset !== 'each' && (
            <p style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
              {summary.noSize.length} product{summary.noSize.length !== 1 ? 's have' : ' has'} no size — ratio will be null
            </p>
          )}
          {summary.skipped.length > 0 && (
            <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
              {summary.skipped.length} skipped: {[...new Set(summary.skipped.map(s => s.skip))].join('; ')}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
          <button className={styles.btnSecondary} onClick={() => { if (!saving) onClose() }}>Cancel</button>
          <button
            className={styles.btnPrimary}
            disabled={saving || summary.saves.length === 0 || (servingPreset === 'custom' && !(parseFloat(customMl) > 0))}
            onClick={() => onSave(servingPreset, customMl)}
          >
            {saving ? 'Saving…' : `Save ${summary.saves.length} item${summary.saves.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Re-match progress ─────────────────────────────────────────────────────────

function RematchProgress({
  done, total, errors, coverageBefore, coverageAfter,
}: {
  done: number; total: number; errors: string[]
  coverageBefore: number | null; coverageAfter: number | null
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Re-matching {done}/{total} reports…</p>
      <div className={styles.progressWrap}>
        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
      </div>
      {errors.length > 0 && (
        <p className={styles.errorText} style={{ marginTop: 4 }}>
          {errors.length} error{errors.length !== 1 ? 's' : ''}: {errors[0]}{errors.length > 1 ? ` +${errors.length - 1} more` : ''}
        </p>
      )}
      {done === total && total > 0 && (
        <div className={styles.coverageRow} style={{ marginTop: 6 }}>
          {coverageBefore != null && coverageAfter != null
            ? <>Coverage: <span className={styles.coveragePct}>{coverageBefore.toFixed(0)}%</span> → <span className={styles.coveragePct}>{coverageAfter.toFixed(0)}%</span></>
            : <span>Re-match complete.</span>
          }
        </div>
      )}
    </div>
  )
}

// ── Tab A: Not linked ─────────────────────────────────────────────────────────

function NotLinkedTab({
  rows,
  selected,
  onRowClick,
  onSelectionChange,
  onBulkIgnore,
  saving,
  rematching,
}: {
  rows: UnmatchedRow[]
  selected: Set<string>
  onRowClick: (row: UnmatchedRow) => void
  onSelectionChange: (sel: Set<string>) => void
  onBulkIgnore: (posNames: string[]) => void
  saving: boolean
  rematching: boolean
}) {
  const [search, setSearch] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r => r.origName.toLowerCase().includes(q))
  }, [rows, search])

  const allFilteredNorms = filtered.map(r => r.normalisedName)
  const allSelected = allFilteredNorms.length > 0 && allFilteredNorms.every(n => selected.has(n))
  const selectedNames = [...selected].map(n => rows.find(r => r.normalisedName === n)?.origName).filter(Boolean) as string[]

  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) { allFilteredNorms.forEach(n => next.delete(n)) }
    else { allFilteredNorms.forEach(n => next.add(n)) }
    onSelectionChange(next)
  }

  function toggleRow(n: string) {
    const next = new Set(selected)
    if (next.has(n)) next.delete(n); else next.add(n)
    onSelectionChange(next)
  }

  if (rows.length === 0) return <p className={styles.emptyState}>No unlinked items — everything has a mapping.</p>

  return (
    <div>
      <div className={styles.tableActions}>
        <input
          className={styles.searchInput}
          style={{ width: 220 }}
          placeholder="Search POS name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {selected.size > 0 && (
          <button
            className={`${styles.btnPrimary}`}
            disabled={saving || rematching}
            onClick={() => setShowConfirm(true)}
          >
            Ignore {selected.size} selected
          </button>
        )}
      </div>

      {showConfirm && (
        <div className={styles.confirmPanel}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>Ignore {selectedNames.length} item{selectedNames.length !== 1 ? 's' : ''}?</p>
          {selectedNames.slice(0, 5).map(n => <div key={n} style={{ fontSize: 12 }}>{n}</div>)}
          {selectedNames.length > 5 && <div style={{ fontSize: 12, color: '#9ca3af' }}>+{selectedNames.length - 5} more…</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className={styles.btnPrimary} disabled={saving || rematching} onClick={() => { setShowConfirm(false); onBulkIgnore(selectedNames) }}>Confirm</button>
            <button className={styles.btnSecondary} onClick={() => setShowConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>POS name</th>
              <th>Units sold</th>
              <th>Reports</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.normalisedName} className={styles.clickableRow} onClick={() => onRowClick(r)}>
                <td onClick={e => { e.stopPropagation(); toggleRow(r.normalisedName) }}>
                  <input type="checkbox" checked={selected.has(r.normalisedName)} onChange={() => toggleRow(r.normalisedName)} />
                </td>
                <td style={{ fontWeight: 500 }}>{r.origName}</td>
                <td>{r.totalQty}</td>
                <td>{r.reportCount}</td>
                <td>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(r) }}>Map</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab B: No serving size ────────────────────────────────────────────────────

function NoServingTab({
  rows,
  products,
  selected,
  onRowClick,
  onSelectionChange,
  onBulkServing,
  saving,
  rematching,
}: {
  rows: NoServingRow[]
  products: Product[]
  selected: Set<string>
  onRowClick: (row: NoServingRow) => void
  onSelectionChange: (sel: Set<string>) => void
  onBulkServing: (posNames: string[]) => void
  saving: boolean
  rematching: boolean
}) {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const row of rows) {
      const p = products.find(pr => pr.id === row.productId)
      if (p?.category) cats.add(p.category)
    }
    return [...cats].sort()
  }, [rows, products])

  const filtered = useMemo(() => {
    let r = rows
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(row => row.posName.toLowerCase().includes(q) || row.productName.toLowerCase().includes(q))
    }
    if (categoryFilter) {
      r = r.filter(row => {
        const p = products.find(pr => pr.id === row.productId)
        return p?.category === categoryFilter
      })
    }
    return r
  }, [rows, products, search, categoryFilter])

  const allFilteredNorms = filtered.map(r => r.normalisedName)
  const allSelected = allFilteredNorms.length > 0 && allFilteredNorms.every(n => selected.has(n))
  const selectedNames = [...selected].map(n => rows.find(r => r.normalisedName === n)?.posName).filter(Boolean) as string[]

  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) { allFilteredNorms.forEach(n => next.delete(n)) }
    else { allFilteredNorms.forEach(n => next.add(n)) }
    onSelectionChange(next)
  }

  function toggleRow(n: string) {
    const next = new Set(selected)
    if (next.has(n)) next.delete(n); else next.add(n)
    onSelectionChange(next)
  }

  if (rows.length === 0) return <p className={styles.emptyState}>All matched items have serving sizes configured.</p>

  return (
    <div>
      <div className={styles.tableActions}>
        <input
          className={styles.searchInput}
          style={{ width: 220 }}
          placeholder="Search POS or product…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6 }}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {selected.size > 0 && (
          <button
            className={styles.btnPrimary}
            disabled={saving || rematching}
            onClick={() => onBulkServing(selectedNames)}
          >
            Set serving size for {selected.size} selected
          </button>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>POS name</th>
              <th>Matched product</th>
              <th>Units sold</th>
              <th>Reports</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.normalisedName} className={styles.clickableRow} onClick={() => onRowClick(r)}>
                <td onClick={e => { e.stopPropagation(); toggleRow(r.normalisedName) }}>
                  <input type="checkbox" checked={selected.has(r.normalisedName)} onChange={() => toggleRow(r.normalisedName)} />
                </td>
                <td style={{ fontWeight: 500 }}>{r.posName}</td>
                <td style={{ color: '#6b7280' }}>{r.productName}</td>
                <td>{r.totalQty}</td>
                <td>{r.reportIds.length}</td>
                <td>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(r) }}>Set size</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab C: All mappings ───────────────────────────────────────────────────────

type AllMappingsFilter = 'all' | 'product' | 'recipe' | 'ignored' | 'merged-missing' | 'no-serving' | 'duplicate' | 'versioned' | 'needs-decision'

function AllMappingsTab({
  rows,
  onRowClick,
  straddlesByKey,
  versionsData,
  canManage,
  onOverride,
}: {
  rows: AllMappingRow[]
  onRowClick: (row: AllMappingRow) => void
  straddlesByKey: Record<string, StraddleDecision[]>
  versionsData: Record<string, MappingVersionData[]>
  canManage: boolean
  onOverride: (reportId: string, mappingKey: string, versionId: string) => Promise<void>
}) {
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<AllMappingsFilter>('all')

  const filtered = useMemo(() => {
    let r = rows
    if (filter === 'product')       r = r.filter(row => row.mapping.mappingType === 'direct_product')
    else if (filter === 'recipe')   r = r.filter(row => row.mapping.mappingType === 'recipe')
    else if (filter === 'ignored')  r = r.filter(row => row.mapping.mappingType === 'skipped')
    else if (filter === 'merged-missing') r = r.filter(row => row.warningMergedOrMissing)
    else if (filter === 'no-serving')    r = r.filter(row => row.warningNoServing)
    else if (filter === 'duplicate')     r = r.filter(row => row.warningDuplicate)
    else if (filter === 'versioned')     r = r.filter(row => row.versioned)
    else if (filter === 'needs-decision') r = r.filter(row => {
      const key = (row.mapping.posItemName || '').toLowerCase()
      return (straddlesByKey[key]?.length ?? 0) > 0
    })
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(row =>
        row.mapping.posItemName.toLowerCase().includes(q) ||
        row.targetLabel.toLowerCase().includes(q)
      )
    }
    return r
  }, [rows, filter, search, straddlesByKey])

  const duplicateCount = rows.filter(r => r.warningDuplicate).length
  const totalStraddling = Object.values(straddlesByKey).reduce((s, d) => s + d.length, 0)
  const chips: Array<{ key: AllMappingsFilter; label: string; warn?: boolean }> = [
    { key: 'all',           label: `All (${rows.length})` },
    { key: 'product',       label: `Product (${rows.filter(r => r.mapping.mappingType === 'direct_product').length})` },
    { key: 'recipe',        label: `Recipe (${rows.filter(r => r.mapping.mappingType === 'recipe').length})` },
    { key: 'ignored',       label: `Ignored (${rows.filter(r => r.mapping.mappingType === 'skipped').length})` },
    { key: 'merged-missing', label: `Points to merged/missing (${rows.filter(r => r.warningMergedOrMissing).length})`, warn: true },
    { key: 'no-serving',    label: `Product, no serving size (${rows.filter(r => r.warningNoServing).length})`, warn: true },
    ...(duplicateCount > 0 ? [{ key: 'duplicate' as const, label: `Duplicate mappings (${duplicateCount})`, warn: true }] : []),
    ...(rows.some(r => r.versioned) ? [{ key: 'versioned' as const, label: `Versioned (${rows.filter(r => r.versioned).length})` }] : []),
    ...(totalStraddling > 0 ? [{ key: 'needs-decision' as const, label: `Needs a decision (${totalStraddling})`, warn: true }] : []),
  ]

  if (rows.length === 0) return <p className={styles.emptyState}>No mappings found.</p>

  return (
    <div>
      <div className={styles.tableActions}>
        <input
          className={styles.searchInput}
          style={{ width: 240 }}
          placeholder="Search POS name or target…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.filterChips}>
        {chips.map(c => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={filter === c.key
              ? (c.warn ? styles.warnChipActive : styles.filterChipActive)
              : (c.warn ? styles.warnChip : styles.filterChip)
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>POS name</th>
              <th>Type</th>
              <th>Target</th>
              <th>Serving</th>
              <th>Ratio</th>
              <th>Seen in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const rowKey = (row.mapping.posItemName || '').toLowerCase()
              const straddleDecisions = straddlesByKey[rowKey] ?? []
              const keyVersions = versionsData[rowKey] ?? []
              return [
                <tr key={row.mapping.id} className={styles.clickableRow} onClick={() => onRowClick(row)}>
                  <td style={{ fontWeight: 500 }}>
                    {row.mapping.posItemName}
                    {row.docCount > 1 && (
                      <span className={`${styles.badge} ${styles.badgeAmber}`} style={{ marginLeft: 6 }}>
                        {row.docCount} records
                      </span>
                    )}
                    {row.versioned && (
                      <span className={`${styles.badge} ${styles.badgeBlue}`} style={{ marginLeft: 6 }}>
                        versioned
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${
                      row.mapping.mappingType === 'direct_product' ? styles.badgeBlue
                      : row.mapping.mappingType === 'recipe' ? styles.badgeGreen
                      : styles.badgeGray
                    }`}>
                      {row.mapping.mappingType === 'direct_product' ? 'product'
                        : row.mapping.mappingType === 'recipe' ? 'recipe' : 'ignored'}
                    </span>
                  </td>
                  <td style={{ color: row.warningMergedOrMissing ? '#92400e' : '#374151', fontSize: 12 }}>
                    {row.targetLabel}
                  </td>
                  <td style={{ fontSize: 12, color: '#6b7280' }}>{row.servingLabel}</td>
                  <td style={{ fontSize: 12, color: '#6b7280' }}>
                    {row.ratio != null ? row.ratio.toFixed(3).replace(/\.?0+$/, '') : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: '#6b7280' }}>
                    {row.seenInReports > 0 ? `${row.seenInReports} report${row.seenInReports !== 1 ? 's' : ''}, ${row.totalQtySold} qty` : '—'}
                  </td>
                  <td>
                    <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(row) }}>Edit</button>
                  </td>
                </tr>,
                ...(filter === 'needs-decision' && straddleDecisions.length > 0 ? [
                  <tr key={`${row.mapping.id}-straddle`}>
                    <td colSpan={7} style={{ background: '#fffbeb', padding: '8px 12px', fontSize: 12 }}>
                      {straddleDecisions.map(d => {
                        const period = d.period ?? d.reportId
                        return (
                          <div key={d.reportId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ color: '#374151' }}>{period}:</span>
                            {d.versionIds.map(vid => {
                              const v = keyVersions.find(kv => kv.id === vid)
                              const label = v?.productName ?? v?.recipeName ?? vid.slice(0, 8)
                              return (
                                <button
                                  key={vid}
                                  className={`${styles.btnSmall} ${vid === d.chosenVersionId ? styles.btnPrimary : styles.btnOutline}`}
                                  disabled={!canManage}
                                  onClick={e => { e.stopPropagation(); if (canManage) onOverride(d.reportId, d.mappingKey, vid) }}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </td>
                  </tr>
                ] : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PosMappingPage({
  venueId,
  canManage,
  onNavigate: _onNavigate,
}: {
  venueId: string
  canManage: boolean
  onNavigate: (page: string) => void
}) {
  const [tab, setTab]                         = useState<TabKey>('not-linked')
  const [loading, setLoading]                 = useState(true)
  const [products, setProducts]               = useState<Product[]>([])
  const [recipes, setRecipes]                 = useState<Recipe[]>([])
  const [mappings, setMappings]               = useState<Mapping[]>([])
  const [allDocs, setAllDocs]                 = useState<Array<{ id: string; data(): Record<string, any> }>>([])
  const [matchesByReport, setMatchesByReport] = useState<Record<string, MatchData | null>>({})

  const [panelRow, setPanelRow] = useState<{
    posName: string
    preselectedProduct?: { id: string; name: string } | null
    existingMapping?: Mapping | null
    affectedReports?: { count: number; dateRange: string | null } | null
    versions?: MappingVersionData[]
  } | null>(null)
  const [saving, setSaving]     = useState(false)

  const [notLinkedSelected, setNotLinkedSelected] = useState<Set<string>>(new Set())
  const [noServingSelected, setNoServingSelected] = useState<Set<string>>(new Set())
  const [bulkServingTarget, setBulkServingTarget] = useState<NoServingRow[] | null>(null)

  const [versionsData, setVersionsData] = useState<Record<string, MappingVersionData[]>>({})
  const [versionsLoadError, setVersionsLoadError] = useState(false)
  const [straddleDecisions, setStraddleDecisions] = useState<StraddleDecision[]>([])

  const [saveError, setSaveError] = useState<string | null>(null)

  const [rematchState, setRematchState] = useState<{
    active: boolean; done: number; total: number; errors: string[]
    coverageBefore: number | null; coverageAfter: number | null
  }>({ active: false, done: 0, total: 0, errors: [], coverageBefore: null, coverageAfter: null })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      const [productsSnap, recipesSnap, mappingsSnap, reportsSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'products')),
        getDocs(collection(db, 'venues', venueId, 'recipes')),
        getDocs(collection(db, 'venues', venueId, 'posProductMappings')),
        getDocs(collection(db, 'venues', venueId, 'salesReports')),
      ])
      if (cancelled) return
      setProducts(productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      setRecipes(recipesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      setMappings(mappingsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      const rawDocs = reportsSnap.docs.map(d => ({ id: d.id, data: () => d.data() }))
      setAllDocs(rawDocs)
      const { reports } = partitionReports(rawDocs)
      const mByR: Record<string, MatchData | null> = {}
      await Promise.all(reports.map(async r => {
        const matchSnap = await getDoc(doc(db, 'venues', venueId, 'salesReportMatches', r.id))
        mByR[r.id] = matchSnap.exists() ? matchDocToMatchData(matchSnap.data() as Record<string, any>) : null
      }))
      if (cancelled) return
      setMatchesByReport(mByR)
      const { reports: initialReports } = partitionReports(rawDocs)
      setStraddleDecisions(buildStraddleDecisions(mByR, initialReports))
      setLoading(false)

      // Load versions from API (no client Firestore rule — use ID token)
      try {
        const token = await auth.currentUser?.getIdToken()
        if (token) {
          const resp = await fetch(
            `https://us-central1-tallyup-f1463.cloudfunctions.net/api/pos-mappings/versions?venueId=${venueId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (resp.ok) {
            const json = await resp.json()
            const vByKey: Record<string, MappingVersionData[]> = {}
            ;(json.versions ?? []).forEach((v: MappingVersionData) => {
              const k = v.mappingKey || (v.posItemName || '').toLowerCase()
              if (!vByKey[k]) vByKey[k] = []
              vByKey[k].push(v)
            })
            for (const k of Object.keys(vByKey)) {
              vByKey[k].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
            }
            if (!cancelled) setVersionsData(vByKey)
          } else {
            if (!cancelled) setVersionsLoadError(true)
          }
        }
      } catch {
        if (!cancelled) setVersionsLoadError(true)
      }
    }
    load().catch(console.error)
    return () => { cancelled = true }
  }, [venueId])

  const { reports: activeReports } = useMemo(() => partitionReports(allDocs), [allDocs])

  const mappingsByLower = useMemo(() => {
    const m: MappingIndex = {}
    for (const mp of mappings) {
      const k = (mp.posItemName || '').toLowerCase()
      if (k) m[k] = { mappingType: mp.mappingType, servingMl: mp.servingMl ?? null, conversionRatio: mp.conversionRatio ?? null }
    }
    return m
  }, [mappings])

  const unmatchedRows = useMemo(() => buildUnmatchedRows(activeReports, matchesByReport), [activeReports, matchesByReport])
  const notLinkedRows = useMemo(() => buildNotLinkedRows(unmatchedRows, mappingsByLower), [unmatchedRows, mappingsByLower])
  const noServingRows = useMemo(() => buildNoServingRows(activeReports, matchesByReport, mappingsByLower), [activeReports, matchesByReport, mappingsByLower])
  const allMappingsRowsList = useMemo(() => allMappingsRows(mappings, products, recipes, activeReports, matchesByReport, versionsData), [mappings, products, recipes, activeReports, matchesByReport, versionsData])

  const straddlesByKey = useMemo(() => {
    const byKey: Record<string, StraddleDecision[]> = {}
    for (const d of straddleDecisions) {
      if (!byKey[d.mappingKey]) byKey[d.mappingKey] = []
      byKey[d.mappingKey].push(d)
    }
    return byKey
  }, [straddleDecisions])

  async function loadVersions(): Promise<void> {
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const resp = await fetch(
        `${API_BASE}/pos-mappings/versions?venueId=${venueId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (resp.ok) {
        const json = await resp.json()
        const vByKey: Record<string, MappingVersionData[]> = {}
        ;(json.versions ?? []).forEach((v: MappingVersionData) => {
          const k = v.mappingKey || (v.posItemName || '').toLowerCase()
          if (!vByKey[k]) vByKey[k] = []
          vByKey[k].push(v)
        })
        for (const k of Object.keys(vByKey)) {
          vByKey[k].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
        }
        setVersionsData(vByKey)
      } else {
        setVersionsLoadError(true)
      }
    } catch {
      setVersionsLoadError(true)
    }
  }

  async function handleVersionReload(): Promise<void> {
    const mSnap = await getDocs(collection(db, 'venues', venueId, 'posProductMappings'))
    setMappings(mSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    await loadVersions()
    const updated = await reloadMatchesForReports(activeReports.map(r => r.id))
    setMatchesByReport(prev => {
      const next = { ...prev, ...updated }
      setStraddleDecisions(buildStraddleDecisions(next, activeReports))
      return next
    })
  }

  async function handleOverride(reportId: string, mappingKey: string, versionId: string): Promise<void> {
    if (!canManage) return
    setSaveError(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setSaveError('Not authenticated'); return }
      const resp = await fetch(`${API_BASE}/pos-mappings/report-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, reportId, mappingKey, versionId }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) { setSaveError(json.error ?? 'Override failed'); return }
      const updated = await reloadMatchesForReports([reportId])
      setMatchesByReport(prev => {
        const next = { ...prev, ...updated }
        setStraddleDecisions(buildStraddleDecisions(next, activeReports))
        return next
      })
    } catch (e: any) {
      setSaveError(e?.message ?? 'Override failed')
    }
  }

  async function reloadMatchesForReports(reportIds: string[]): Promise<Record<string, MatchData | null>> {
    const updates: Record<string, MatchData | null> = {}
    await Promise.all(reportIds.map(async id => {
      const snap = await getDoc(doc(db, 'venues', venueId, 'salesReportMatches', id))
      updates[id] = snap.exists() ? matchDocToMatchData(snap.data() as Record<string, any>) : null
    }))
    return updates
  }

  function coveragePctFor(mByR: Record<string, MatchData | null>, reportIds: string[]): number | null {
    let totalQty = 0; let matchedQty = 0
    for (const id of reportIds) {
      const md = mByR[id]; if (!md?.coverage) continue
      const r = activeReports.find(a => a.id === id); if (!r) continue
      totalQty += r.totalQtySold
      matchedQty += r.totalQtySold * ((md.coverage.matchedPct ?? 0) + (md.coverage.recipePct ?? 0) + (md.coverage.ignoredPct ?? 0)) / 100
    }
    return totalQty > 0 ? (matchedQty / totalQty) * 100 : null
  }

  async function runRematch(affectedIds: string[], currentMatchesByReport: Record<string, MatchData | null>) {
    if (affectedIds.length === 0) return
    const coverageBefore = coveragePctFor(currentMatchesByReport, affectedIds)
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    setRematchState({ active: true, done: 0, total: affectedIds.length, errors: [], coverageBefore, coverageAfter: null })
    const { errors } = await rematchReports(venueId, affectedIds, token, (done, total) => {
      setRematchState(s => ({ ...s, done, total }))
    })
    const updated = await reloadMatchesForReports(affectedIds)
    setMatchesByReport(prev => ({ ...prev, ...updated }))
    const coverageAfter = coveragePctFor({ ...currentMatchesByReport, ...updated }, affectedIds)
    setRematchState(s => ({ ...s, errors, coverageAfter }))
  }

  type SaveInput = { posName: string; payload: Record<string, unknown> }

  async function saveMappings(entries: SaveInput[], kind: 'link' | 'fix' | 'unlink' = 'link'): Promise<{ savedNames: string[]; failed: boolean }> {
    if (!canManage) return { savedNames: [], failed: false }
    setSaving(true)
    setSaveError(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setSaveError('Not authenticated'); setSaving(false); return { savedNames: [], failed: true } }
      const apiEntries = entries.map(e => ({ posItemName: e.posName, mapping: kind === 'unlink' ? null : e.payload }))
      const resp = await fetch(`${API_BASE}/pos-mappings/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, kind, entries: apiEntries }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) {
        setSaveError(json.error ?? 'Save failed')
        setSaving(false)
        return { savedNames: [], failed: true }
      }
      const savedNames = kind === 'unlink' ? entries.map(e => e.posName) : entries.map(e => e.posName)
      // Reload mappings from Firestore to reflect server-side writes
      await handleVersionReload()
      return { savedNames, failed: false }
    } catch (e: any) {
      console.error('saveMappings failed', e)
      setSaveError(`Save failed: ${e?.message ?? 'unknown error'}`)
      return { savedNames: [], failed: true }
    } finally {
      setSaving(false)
    }
  }

  async function handlePanelSave(payload: Record<string, unknown>, posName: string, _existingCreatedAt?: unknown, kind: 'link' | 'fix' = 'link') {
    if (!canManage) return
    const { failed } = await saveMappings([{ posName, payload }], kind)
    if (!failed) {
      setPanelRow(null)
    }
  }

  async function handleUnlink(mapping: Mapping) {
    if (!canManage) return
    setSaving(true)
    setSaveError(null)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setSaveError('Not authenticated'); return }
      const resp = await fetch(`${API_BASE}/pos-mappings/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, kind: 'unlink', entries: [{ posItemName: mapping.posItemName, mapping: null }] }),
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) { setSaveError(json.error ?? 'Unlink failed'); return }
      setPanelRow(null)
      await handleVersionReload()
    } catch (e: any) {
      setSaveError(`Unlink failed: ${e?.message ?? 'unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleBulkIgnore(posNames: string[]) {
    const payloads = buildBulkIgnorePayloads(posNames)
    const entries = payloads.map(({ posName, payload }) => ({ posName, payload }))
    const { failed } = await saveMappings(entries)
    if (!failed) setNotLinkedSelected(new Set())
  }

  async function handleBulkServing(servingPreset: string, customMl: string) {
    if (!bulkServingTarget) return
    const results = buildBulkServingPayloads(bulkServingTarget, products, servingPreset, customMl)
    const entries = results
      .filter((r): r is { posName: string; docId: string; payload: Record<string, unknown> } => !('skip' in r))
      .map(({ posName, payload }) => ({ posName, payload }))
    const { failed } = await saveMappings(entries)
    if (!failed) { setNoServingSelected(new Set()); setBulkServingTarget(null) }
  }

  async function handleRematchAll() {
    if (!canManage || saving || rematchState.active) return
    const allIds = activeReports.map(r => r.id)
    await runRematch(allIds, matchesByReport)
  }

  function openAllMappingRow(row: AllMappingRow) {
    if (!canManage) return
    const norm = wlNormName(row.mapping.posItemName ?? '')
    const affectedIds = activeReports.filter(r => r.rawLines.some(l => wlNormName(l.name ?? '') === norm))
    const dates = affectedIds.map(r => r.startStr).filter(Boolean).sort() as string[]
    const dateRange = dates.length >= 2 ? `${dates[0]} – ${dates[dates.length - 1]}`
      : dates.length === 1 ? dates[0] : null
    const key = (row.mapping.posItemName || '').toLowerCase()
    const keyVersions = versionsData[key] ?? []
    setPanelRow({
      posName: row.mapping.posItemName,
      existingMapping: row.mapping,
      affectedReports: { count: affectedIds.length, dateRange },
      versions: keyVersions,
    })
  }

  if (loading) return <div className={styles.page}><p className={styles.loading}>Loading POS mapping data…</p></div>

  return (
    <div className={styles.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 className={styles.heading}>POS Mapping</h1>
        {canManage && (
          <button
            className={`${styles.btnSmall} ${styles.btnOutline}`}
            disabled={saving || rematchState.active}
            onClick={handleRematchAll}
            style={{ marginBottom: 4 }}
          >
            Re-match all active reports
          </button>
        )}
      </div>
      <p className={styles.subheading}>
        {notLinkedRows.length} unlinked · {noServingRows.length} missing serving size · {mappings.length} total mappings
      </p>

      {versionsLoadError && (
        <div className={`${styles.banner} ${styles.bannerAmber}`} style={{ marginBottom: 8 }}>
          Version history unavailable. Fix a mistake and Unlink are disabled.
        </div>
      )}

      {saveError && (
        <div className={`${styles.banner} ${styles.bannerAmber}`} style={{ marginBottom: 8 }}>
          {saveError}
        </div>
      )}

      {rematchState.active && (
        <RematchProgress
          done={rematchState.done} total={rematchState.total}
          errors={rematchState.errors}
          coverageBefore={rematchState.coverageBefore}
          coverageAfter={rematchState.coverageAfter}
        />
      )}

      <div className={styles.tabs}>
        {([
          { key: 'not-linked' as const, label: `Not linked (${notLinkedRows.length})` },
          { key: 'no-serving' as const, label: `No serving size (${noServingRows.length})` },
          { key: 'all-mappings' as const, label: `All mappings (${mappings.length})` },
        ]).map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!canManage && (
        <div className={`${styles.banner} ${styles.bannerAmber}`}>
          You have read-only access. Ask an owner or manager to save mappings.
        </div>
      )}

      {tab === 'not-linked' && (
        <NotLinkedTab
          rows={notLinkedRows}
          selected={notLinkedSelected}
          onRowClick={row => canManage && setPanelRow({ posName: row.origName })}
          onSelectionChange={setNotLinkedSelected}
          onBulkIgnore={handleBulkIgnore}
          saving={saving}
          rematching={rematchState.active && rematchState.done < rematchState.total}
        />
      )}

      {tab === 'no-serving' && (
        <NoServingTab
          rows={noServingRows}
          products={products}
          selected={noServingSelected}
          onRowClick={row => canManage && setPanelRow({
            posName: row.posName,
            preselectedProduct: { id: row.productId, name: row.productName },
          })}
          onSelectionChange={setNoServingSelected}
          onBulkServing={posNames => {
            const selectedRows = noServingRows.filter(r => posNames.includes(r.posName))
            setBulkServingTarget(selectedRows)
          }}
          saving={saving}
          rematching={rematchState.active && rematchState.done < rematchState.total}
        />
      )}

      {tab === 'all-mappings' && (
        <AllMappingsTab
          rows={allMappingsRowsList}
          onRowClick={openAllMappingRow}
          straddlesByKey={straddlesByKey}
          versionsData={versionsData}
          canManage={canManage}
          onOverride={handleOverride}
        />
      )}

      {panelRow && (
        <MappingPanel
          posName={panelRow.posName}
          preselectedProduct={panelRow.preselectedProduct}
          existingMapping={panelRow.existingMapping}
          affectedReports={panelRow.affectedReports}
          versions={panelRow.versions}
          versionsUnavailable={versionsLoadError}
          products={products}
          recipes={recipes}
          saving={saving}
          venueId={venueId}
          canManage={canManage}
          onSave={handlePanelSave}
          onClose={() => setPanelRow(null)}
          onUnlink={panelRow.existingMapping ? () => handleUnlink(panelRow.existingMapping!) : undefined}
          onVersionReload={handleVersionReload}
        />
      )}

      {bulkServingTarget && (
        <BulkServingPanel
          selectedRows={bulkServingTarget}
          products={products}
          saving={saving}
          onSave={handleBulkServing}
          onClose={() => setBulkServingTarget(null)}
        />
      )}
    </div>
  )
}
