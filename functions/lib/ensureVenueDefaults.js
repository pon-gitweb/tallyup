"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureVenueDefaultsCallable = void 0;
exports.ensureVenueDefaults = ensureVenueDefaults;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
/**
 * Idempotently ensures server-owned venue docs exist.
 * Writes are via Admin SDK (bypasses rules) -> correct for server-only collections.
 */
async function ensureVenueDefaults(venueId, actorUid) {
    const db = admin.firestore();
    const entRef = db.doc(`venues/${venueId}/entitlements/core`);
    const billRef = db.doc(`venues/${venueId}/billing/status`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    // Use create() so we don't overwrite if already present.
    // If it exists, create() throws ALREADY_EXISTS; we ignore.
    await entRef.create({
        kind: "core_entitlements",
        venueId,
        enforcementMode: "monitor", // monitor-only for now; enforcement later
        stockTakesCompleted: 0,
        freeStockTakesAllowance: 2,
        createdAt: now,
        updatedAt: now,
    }).catch((e) => {
        if (e?.code !== 6)
            throw e; // 6 = ALREADY_EXISTS
    });
    await billRef.create({
        kind: "billing_status",
        venueId,
        status: "unknown", // will be updated by billing integration later
        readOnly: false, // survivability-first later
        createdAt: now,
        updatedAt: now,
    }).catch((e) => {
        if (e?.code !== 6)
            throw e;
    });
    // Append-only event (always ok to write)
    const evRef = db.collection(`venues/${venueId}/events`).doc();
    await evRef.set({
        type: "venue_defaults_ensured",
        venueId,
        actorUid: actorUid ?? null,
        createdAt: now,
    });
}
/**
 * Optional callable for operators/admin to backfill a venue.
 * Keeps scope narrow: only ensures defaults, does not enforce paywall.
 */
exports.ensureVenueDefaultsCallable = (0, https_1.onCall)(async (req) => {
    if (!req.auth) {
        throw new Error("unauthenticated");
    }
    const venueId = (req.data?.venueId ?? "").toString();
    if (!venueId) {
        throw new Error("missing_venueId");
    }
    await ensureVenueDefaults(venueId, req.auth.uid);
    return { ok: true };
});
//# sourceMappingURL=ensureVenueDefaults.js.map