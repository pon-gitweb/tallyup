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
exports.refreshMyClaims = exports.onMemberWrite = void 0;
const admin = __importStar(require("firebase-admin"));
const functions = __importStar(require("firebase-functions"));
const auth = admin.auth();
async function setClaims(uid, venueId, role) {
    const user = await auth.getUser(uid);
    const existing = user.customClaims || {};
    const venues = Object.assign(Object.assign({}, (existing.venues || {})), { [venueId]: true });
    const venue_roles = Object.assign(Object.assign({}, (existing.venue_roles || {})), { [venueId]: role });
    const next = Object.assign(Object.assign({}, existing), { venues, venue_roles });
    const was = JSON.stringify({ venues: existing.venues, venue_roles: existing.venue_roles });
    const now = JSON.stringify({ venues, venue_roles });
    if (was !== now) {
        await auth.setCustomUserClaims(uid, next);
    }
}
exports.onMemberWrite = functions.firestore
    .document('venues/{venueId}/members/{uid}')
    .onWrite(async (snap, ctx) => {
    var _a, _b, _c;
    const { venueId, uid } = ctx.params;
    const after = snap.after.exists ? snap.after.data() : null;
    if (!after) {
        // Member removed -> strip this venue from claims
        const user = await auth.getUser(uid);
        const cc = user.customClaims || {};
        if (((_a = cc.venues) === null || _a === void 0 ? void 0 : _a[venueId]) || ((_b = cc.venue_roles) === null || _b === void 0 ? void 0 : _b[venueId])) {
            if (cc.venues)
                delete cc.venues[venueId];
            if (cc.venue_roles)
                delete cc.venue_roles[venueId];
            await auth.setCustomUserClaims(uid, cc);
        }
        return;
    }
    const role = (_c = after.role) !== null && _c !== void 0 ? _c : 'member';
    await setClaims(uid, venueId, role);
    // Optional nudge for clients to refresh snapshots
    await admin.firestore().doc(`users/${uid}`).set({ touchedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
});
exports.refreshMyClaims = functions.https.onCall(async (data, context) => {
    var _a;
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    }
    const uid = context.auth.uid;
    const venueId = String((data === null || data === void 0 ? void 0 : data.venueId) || '');
    if (!venueId) {
        throw new functions.https.HttpsError('invalid-argument', 'venueId required');
    }
    const memberSnap = await admin.firestore().doc(`venues/${venueId}/members/${uid}`).get();
    if (!memberSnap.exists) {
        return { refreshed: false, reason: 'not_member' };
    }
    const role = ((_a = memberSnap.data()) === null || _a === void 0 ? void 0 : _a.role) || 'member';
    await setClaims(uid, venueId, role);
    return { refreshed: true };
});
//# sourceMappingURL=membership.js.map