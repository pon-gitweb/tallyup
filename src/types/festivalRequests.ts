/**
 * Firestore: venues/{venueId}/requests/{requestId}
 *
 * Shared type definitions for festival top-up / rider / reallocation /
 * load-in request documents.
 *
 * All four festival screens that read/write this collection are currently
 * @ts-nocheck and treat request docs as `any`. This file is the authoritative
 * schema definition introduced in Phase 1 of the Festival Physical Handoff
 * System — it does not change any runtime behaviour; it only documents and
 * constrains what the collection is allowed to contain.
 *
 * Conventions used below:
 *   "existing"       — field already written by at least one live screen today.
 *   "Phase 1 — schema only" — new field; no screen writes it yet.
 */

import type { Timestamp } from 'firebase/firestore';

// ─── Line item ────────────────────────────────────────────────────────────────

/**
 * One product line within a request's `products` array.
 * Mirrors the local `LineItem` type in FestivalTopUpRequestScreen.tsx,
 * which is the canonical write source.
 */
export interface FestivalRequestLineItem {
  // existing ─────────────────────────────────────────────────────────────────
  productId:   string;
  productName: string;
  quantity:    number;
  unit:        string;

  // Phase 1 — schema only (no screen writes these yet) ──────────────────────
  /** Quantity physically loaded by the runner at pickup. Set at pickup scan. */
  sentQty?:     number;
  /** Quantity the receiver confirms arrived. Set at receiving confirmation. */
  receivedQty?: number;
}

// ─── Request document ────────────────────────────────────────────────────────

/**
 * Full shape of a document at venues/{venueId}/requests/{requestId}.
 * All fields are optional except `status`, which every write path already sets.
 */
export interface FestivalRequestDoc {

  // ── existing — top-up request (FestivalTopUpRequestScreen) ────────────────
  barId?:              string | null;
  barName?:            string;
  requestedBy?:        string;       // uid
  requestedByName?:    string;
  products?:           FestivalRequestLineItem[];
  urgency?:            'asap' | 'next-round' | 'planning';
  note?:               string | null;
  status:              'pending' | 'accepted' | 'collected' | 'delivered' | 'cancelled';
  sourceLocationId?:   string | null;
  sourceLocationName?: string | null;
  createdAt?:          Timestamp;
  updatedAt?:          Timestamp;

  // ── existing — lifecycle transition writes (FestivalDeliveryTasksScreen) ──
  assignedTo?:        string;        // uid
  assignedToName?:    string;
  acceptedAt?:        Timestamp;
  collectedAt?:       Timestamp;
  completedAt?:       Timestamp;
  cancelledBy?:       string;        // uid

  // ── existing — ops-screen cancel ─────────────────────────────────────────
  // (cancelledBy already listed above; updatedAt covers the ops write)

  // ── existing — rider request (FestivalRiderDetailScreen) ─────────────────
  type?:                       'top_up' | 'reallocation' | 'load_in' | 'emergency' | 'rider';
  riderId?:                    string;
  artistName?:                 string;
  setTime?:                    string | null;
  deliveryTime?:               string | null;
  deliveryLocation?:           string | null;
  stockSource?:                string;
  excludeFromReconciliation?:  boolean;
  createdBy?:                  string;  // uid

  // ── Phase 1 — schema only (no screen writes these yet) ───────────────────

  /**
   * Department the stock is sourced from (the runner's "collect from"
   * location). Typically the HQ department id, but may be any department for
   * reallocation requests.
   */
  originDepartmentId?: string;

  /**
   * Area within `originDepartmentId` the runner physically collects from
   * (e.g. the specific HQ storage area assigned to this bar).
   */
  originAreaId?: string;

  /**
   * UTC timestamp and uid recorded when the runner scans the pickup QR at the
   * source location, confirming physical possession of the stock.
   */
  pickupScannedAt?:  Timestamp;
  pickupScannedBy?:  string;  // uid

  /**
   * UTC timestamp and uid recorded when the runner scans the destination QR
   * at the bar / dressing room, proving physical presence at delivery point.
   */
  arrivalScannedAt?: Timestamp;
  arrivalScannedBy?: string;  // uid

  /**
   * UTC timestamp and uid recorded when the receiving party (e.g. bar manager
   * or tour manager) confirms physical receipt of the items.
   */
  receivingConfirmedAt?:    Timestamp;
  receivingConfirmedByUid?: string;

  /**
   * If this request was split from a larger one, points to the parent's id.
   * Null means this is a top-level request (not a split child).
   */
  parentRequestId?: string | null;

  /**
   * True when a request is entered after the physical delivery already
   * occurred (e.g. verbal approval from ops, logged after the fact).
   * `loggedByUid` records who entered it retroactively.
   */
  loggedRetroactively?: boolean;
  loggedByUid?:         string;  // uid

  /**
   * Soft stuck flag — set when a runner has accepted a task but not
   * progressed it within an expected window, or when ops manually flags it.
   */
  stuck?:              boolean;
  stuckReason?:        string;
  stuckFlaggedByUid?:  string;  // uid
  stuckFlaggedAt?:     Timestamp;

  /**
   * Soft dispute flag — set when the receiving party disagrees with what
   * was delivered (wrong product, wrong quantity, damaged).
   * Does not automatically change `status`; dispute resolution is handled
   * by ops as a separate workflow.
   */
  disputed?:        boolean;
  disputedByUid?:   string;  // uid
  disputedAt?:      Timestamp;
  disputeNote?:     string;

  /**
   * If this request was created to correct an earlier one, points to the
   * original request's id. Null means it is not a correction.
   */
  correctedFromRequestId?: string | null;
}
