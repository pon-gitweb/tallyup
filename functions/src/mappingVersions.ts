/**
 * Pure functions for the POS mapping version system.
 * No Firestore access — all data is passed in. Testable without Firebase.
 */

import { MappingDoc } from './mappingConversion';

// ── Types ─────────────────────────────────────────────────────────────────────

export const MAPPING_FIELDS = [
  'mappingType', 'productId', 'productName', 'recipeId', 'recipeName',
  'servingMl', 'conversionRatio', 'servingType', 'conversionUnit',
] as const;

export type MappingFieldKey = typeof MAPPING_FIELDS[number];

export interface VersionMappingFields {
  mappingType: string | null;
  productId: string | null;
  productName: string | null;
  recipeId: string | null;
  recipeName: string | null;
  servingMl: number | null;
  conversionRatio: number | null;
  servingType: string | null;
  conversionUnit: string | null;
}

export interface MappingVersion extends VersionMappingFields {
  id: string;
  mappingKey: string;
  posItemName: string;
  effectiveFrom: string; // YYYY-MM-DD; '0000-01-01' = v0 sentinel
  createdAt: unknown;
  createdByUid: string;
  updatedByTrigger?: boolean;
  updatedAt?: unknown;
}

export interface MappingDocSnapshot {
  id: string;
  posItemName: string;
  posSystem?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  mappingType?: string | null;
  productId?: string | null;
  productName?: string | null;
  recipeId?: string | null;
  recipeName?: string | null;
  servingMl?: number | null;
  conversionRatio?: number | null;
  servingType?: string | null;
  conversionUnit?: string | null;
}

export type SelectVersionResult =
  | { version: MappingVersion }
  | { straddle: string[]; defaultVersionId: string }
  | { none: true };

// Path-based write ops for pure planners (no real Firestore objects)
export type PlanWrite =
  | { kind: 'set'; path: string; data: Record<string, unknown> }
  | { kind: 'delete'; path: string };

// ── reportDates ───────────────────────────────────────────────────────────────

/**
 * Returns all YYYY-MM-DD calendar dates in [periodStart, periodEnd] expressed
 * in the given IANA timezone. Max 400 dates (safety guard).
 */
export function reportDates(periodStart: Date, periodEnd: Date, tz: string): string[] {
  const startStr = periodStart.toLocaleDateString('en-CA', { timeZone: tz });
  const endStr   = periodEnd.toLocaleDateString('en-CA',   { timeZone: tz });
  if (startStr > endStr) return [];
  const dates: string[] = [];
  let d = startStr;
  while (d <= endStr && dates.length < 400) {
    dates.push(d);
    const [y, m, day] = d.split('-').map(Number);
    const next = new Date(Date.UTC(y, m - 1, day + 1));
    d = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  }
  return dates;
}

// ── selectVersion ─────────────────────────────────────────────────────────────

/**
 * Given versions sorted by effectiveFrom ascending and the report's date range,
 * returns which version applies (single), a straddle descriptor, or none.
 *
 * A version is "effective on a date" if it has the highest effectiveFrom <= that date.
 * '0000-01-01' (v0 sentinel) is always <= any real date.
 */
export function selectVersion(
  versions: MappingVersion[],
  dates: string[],
): SelectVersionResult {
  if (versions.length === 0) return { none: true };

  function effectiveVersionId(date: string): string {
    // latest version with effectiveFrom <= date
    let best = versions[0];
    for (const v of versions) {
      if (v.effectiveFrom <= date) best = v;
      else break;
    }
    return best.id;
  }

  if (dates.length === 0) {
    // No report dates — use the most current version
    return { version: versions[versions.length - 1] };
  }

  const versionIds = new Set(dates.map(effectiveVersionId));

  if (versionIds.size === 1) {
    const id = [...versionIds][0];
    return { version: versions.find(v => v.id === id)! };
  }

  const defaultId = effectiveVersionId(dates[dates.length - 1]);
  return { straddle: [...versionIds], defaultVersionId: defaultId };
}

// ── validateNewVersion ────────────────────────────────────────────────────────

export function validateNewVersion(
  versions: MappingVersion[], // sorted by effectiveFrom asc
  effectiveFrom: string,
  todayStr: string,
): { ok: true } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { ok: false, error: 'effectiveFrom must be YYYY-MM-DD' };
  }
  if (effectiveFrom > todayStr) {
    return { ok: false, error: `effectiveFrom cannot be in the future (today is ${todayStr})` };
  }
  if (versions.length > 0) {
    const latest = versions[versions.length - 1];
    if (effectiveFrom <= latest.effectiveFrom) {
      return { ok: false, error: `effectiveFrom must be after the latest version (${latest.effectiveFrom})` };
    }
  }
  return { ok: true };
}

// ── diffMappingVsVersion ──────────────────────────────────────────────────────

/**
 * Returns true if any tracked mapping field differs between the parent doc
 * and the latest version. null ≡ undefined for all fields.
 */
export function diffMappingVsVersion(
  parent: Record<string, unknown>,
  latest: VersionMappingFields,
): boolean {
  const latestRec = latest as unknown as Record<string, unknown>;
  for (const field of MAPPING_FIELDS) {
    const pv = parent[field] ?? null;
    const lv = latestRec[field] ?? null;
    if (pv !== lv) return true;
  }
  return false;
}

// ── applyVersionsToMappings ───────────────────────────────────────────────────

export interface VersionInfo {
  versionId: string;
  straddle?: { versionIds: string[]; defaultVersionId: string; overridden: boolean };
}

/**
 * Pure helper used by matchAndStoreSalesLines.
 * Overrides fullMappings/confirmedMappings entries for keys that have versions,
 * and returns per-key version selection info (for adding to match entries).
 */
export function applyVersionsToMappings(
  fullMappings: Record<string, (MappingDoc & { id: string }) | undefined>,
  confirmedMappings: Record<string, string>,
  versionsByKey: Record<string, MappingVersion[]>,
  reportDateArr: string[],
  overrideByKey: Record<string, string>,
): {
  versionedFullMappings: Record<string, MappingDoc & { id: string }>;
  versionedConfirmedMappings: Record<string, string>;
  versionInfoPerKey: Record<string, VersionInfo>;
} {
  const versionedFullMappings = { ...(fullMappings as Record<string, MappingDoc & { id: string }>) };
  const versionedConfirmedMappings = { ...confirmedMappings };
  const versionInfoPerKey: Record<string, VersionInfo> = {};

  for (const [key, versions] of Object.entries(versionsByKey)) {
    if (versions.length === 0) continue;

    const selection = selectVersion(versions, reportDateArr);
    if ('none' in selection) continue;

    let chosenVersionId: string;
    let straddleInfo: VersionInfo['straddle'];

    if ('version' in selection) {
      chosenVersionId = selection.version.id;
    } else {
      const override = overrideByKey[key];
      chosenVersionId = override ?? selection.defaultVersionId;
      straddleInfo = {
        versionIds: selection.straddle,
        defaultVersionId: selection.defaultVersionId,
        overridden: !!override,
      };
    }

    const chosen = versions.find(v => v.id === chosenVersionId);
    if (!chosen) continue;

    versionedFullMappings[key] = {
      id: versionedFullMappings[key]?.id ?? key,
      posItemName: chosen.posItemName,
      posSystem: (versionedFullMappings[key] as any)?.posSystem ?? 'csv',
      mappingType: chosen.mappingType ?? null,
      productId:   chosen.productId   ?? null,
      recipeId:    chosen.recipeId    ?? null,
      servingMl:   chosen.servingMl   ?? null,
      conversionRatio: chosen.conversionRatio ?? null,
      servingType:     chosen.servingType     ?? null,
      conversionUnit:  chosen.conversionUnit  ?? null,
    } as MappingDoc & { id: string };

    if (chosen.productId && chosen.mappingType !== 'skipped' && !chosen.recipeId) {
      versionedConfirmedMappings[key] = chosen.productId;
    } else {
      delete versionedConfirmedMappings[key];
    }

    versionInfoPerKey[key] = { versionId: chosenVersionId, straddle: straddleInfo };
  }

  return { versionedFullMappings, versionedConfirmedMappings, versionInfoPerKey };
}

// ── Shared helpers (mirror of web-app mappingId.ts) ───────────────────────────

function normNameForId(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

export function mappingDocId(posItemName: string, posSystem: string): string {
  return `${normNameForId(posItemName).replace(/\s+/g, '_')}_${posSystem}`.slice(0, 500);
}

function toTs(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val !== null) {
    if ('toMillis' in val) return (val as any).toMillis();
    if ('seconds' in val) return (val as any).seconds * 1000;
  }
  return 0;
}

// ── planChangeProduct ─────────────────────────────────────────────────────────

export function planChangeProduct(args: {
  venueId: string;
  posItemName: string;
  mappingKey: string;
  effectiveFrom: string;
  newFields: VersionMappingFields;
  existingMappingDocs: MappingDocSnapshot[];
  existingVersions: MappingVersion[]; // sorted by effectiveFrom asc
  newVersionId: string;
  v0Id: string;
  uid: string;
  todayStr: string;
}): { ok: true; writes: PlanWrite[]; v0Created: boolean } | { ok: false; error: string } {
  const {
    venueId, posItemName, mappingKey, effectiveFrom, newFields,
    existingMappingDocs, existingVersions, newVersionId, v0Id, uid, todayStr,
  } = args;

  const validation = validateNewVersion(existingVersions, effectiveFrom, todayStr);
  if (!validation.ok) return { ok: false as const, error: (validation as { ok: false; error: string }).error };

  const writes: PlanWrite[] = [];

  // Identify canonical mapping doc
  let canonical: MappingDocSnapshot;
  if (existingMappingDocs.length === 0) {
    canonical = { id: mappingDocId(posItemName, 'csv'), posItemName, posSystem: 'csv' };
  } else {
    const preferred = existingMappingDocs.find(
      d => d.id === mappingDocId(posItemName, d.posSystem || 'csv')
    );
    canonical = preferred ?? existingMappingDocs.reduce((a, b) => toTs(b.updatedAt) > toTs(a.updatedAt) ? b : a);
    for (const d of existingMappingDocs) {
      if (d.id !== canonical.id) {
        writes.push({ kind: 'delete', path: `venues/${venueId}/posProductMappings/${d.id}` });
      }
    }
  }

  const earliestCreatedAt = existingMappingDocs.length === 0 ? null :
    existingMappingDocs.reduce<unknown>((earliest, d) => {
      if (earliest === null) return d.createdAt ?? null;
      return toTs(d.createdAt) < toTs(earliest) ? d.createdAt ?? null : earliest;
    }, null);

  let v0Created = false;
  if (existingVersions.length === 0) {
    // Snapshot the current parent state as v0
    const currentFields: VersionMappingFields = {
      mappingType:     (canonical.mappingType     ?? null) as string | null,
      productId:       canonical.productId        ?? null,
      productName:     canonical.productName      ?? null,
      recipeId:        canonical.recipeId         ?? null,
      recipeName:      canonical.recipeName       ?? null,
      servingMl:       canonical.servingMl        ?? null,
      conversionRatio: canonical.conversionRatio  ?? null,
      servingType:     canonical.servingType      ?? null,
      conversionUnit:  canonical.conversionUnit   ?? null,
    };
    writes.push({
      kind: 'set',
      path: `venues/${venueId}/posMappingVersions/${v0Id}`,
      data: { mappingKey, posItemName, effectiveFrom: '0000-01-01', ...currentFields, createdByUid: uid },
    });
    v0Created = true;
  }

  // New version
  writes.push({
    kind: 'set',
    path: `venues/${venueId}/posMappingVersions/${newVersionId}`,
    data: { mappingKey, posItemName, effectiveFrom, ...newFields, createdByUid: uid },
  });

  // Update canonical parent doc to new version's fields
  writes.push({
    kind: 'set',
    path: `venues/${venueId}/posProductMappings/${canonical.id}`,
    data: {
      posItemName,
      posSystem: canonical.posSystem || 'csv',
      ...newFields,
      createdAt: earliestCreatedAt ?? '__serverTimestamp__',
    },
  });

  return { ok: true, writes, v0Created };
}

// ── planUndoChange ────────────────────────────────────────────────────────────

export function planUndoChange(args: {
  venueId: string;
  posItemName: string;
  existingMappingDocs: MappingDocSnapshot[];
  existingVersions: MappingVersion[]; // sorted by effectiveFrom asc
}): { ok: true; writes: PlanWrite[]; restoredToUnversioned: boolean } | { ok: false; error: string } {
  const { venueId, posItemName, existingMappingDocs, existingVersions } = args;

  if (existingVersions.length === 0) {
    return { ok: false, error: 'No versions to undo' };
  }
  const latest = existingVersions[existingVersions.length - 1];
  if (latest.effectiveFrom === '0000-01-01') {
    return { ok: false, error: 'Cannot undo v0 — use unlink instead' };
  }

  const writes: PlanWrite[] = [];
  writes.push({ kind: 'delete', path: `venues/${venueId}/posMappingVersions/${latest.id}` });

  const remaining = existingVersions.slice(0, -1);
  let restoredFields: VersionMappingFields;
  let restoredToUnversioned = false;

  if (remaining.length === 1 && remaining[0].effectiveFrom === '0000-01-01') {
    // Only v0 remains — delete it too (back to unversioned)
    writes.push({ kind: 'delete', path: `venues/${venueId}/posMappingVersions/${remaining[0].id}` });
    restoredFields = {
      mappingType:     remaining[0].mappingType,
      productId:       remaining[0].productId,
      productName:     remaining[0].productName,
      recipeId:        remaining[0].recipeId,
      recipeName:      remaining[0].recipeName,
      servingMl:       remaining[0].servingMl,
      conversionRatio: remaining[0].conversionRatio,
      servingType:     remaining[0].servingType,
      conversionUnit:  remaining[0].conversionUnit,
    };
    restoredToUnversioned = true;
  } else {
    const prev = remaining[remaining.length - 1];
    restoredFields = {
      mappingType:     prev.mappingType,
      productId:       prev.productId,
      productName:     prev.productName,
      recipeId:        prev.recipeId,
      recipeName:      prev.recipeName,
      servingMl:       prev.servingMl,
      conversionRatio: prev.conversionRatio,
      servingType:     prev.servingType,
      conversionUnit:  prev.conversionUnit,
    };
  }

  // Restore canonical parent doc
  if (existingMappingDocs.length > 0) {
    const preferred = existingMappingDocs.find(
      d => d.id === mappingDocId(posItemName, d.posSystem || 'csv')
    );
    const canonical = preferred ?? existingMappingDocs.reduce((a, b) =>
      toTs(b.updatedAt) > toTs(a.updatedAt) ? b : a
    );
    const earliestCreatedAt = existingMappingDocs.reduce<unknown>((earliest, d) => {
      if (earliest === null) return d.createdAt ?? null;
      return toTs(d.createdAt) < toTs(earliest) ? d.createdAt ?? null : earliest;
    }, null);
    writes.push({
      kind: 'set',
      path: `venues/${venueId}/posProductMappings/${canonical.id}`,
      data: {
        posItemName,
        posSystem: canonical.posSystem || 'csv',
        ...restoredFields,
        createdAt: earliestCreatedAt ?? '__serverTimestamp__',
      },
    });
    for (const d of existingMappingDocs) {
      if (d.id !== canonical.id) {
        writes.push({ kind: 'delete', path: `venues/${venueId}/posProductMappings/${d.id}` });
      }
    }
  }

  return { ok: true, writes, restoredToUnversioned };
}
