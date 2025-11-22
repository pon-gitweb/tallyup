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
exports.createVenueOwnedByUser = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const uuid_1 = require("uuid");
exports.createVenueOwnedByUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "You must be signed in to create a venue.");
    }
    const rawName = (data && data.name) ? String(data.name) : "";
    const name = rawName.trim();
    if (!name) {
        throw new functions.https.HttpsError("invalid-argument", "Venue name is required.");
    }
    const uid = context.auth.uid;
    const email = (context.auth.token && context.auth.token.email) || null;
    const db = admin.firestore();
    const venueId = `v_${(0, uuid_1.v4)().replace(/-/g, "").slice(0, 20)}`;
    const venueRef = db.doc(`venues/${venueId}`);
    const memberRef = venueRef.collection("members").doc(uid);
    const userRef = db.doc(`users/${uid}`);
    await db.runTransaction(async (tx) => {
        var _a;
        const userSnap = await tx.get(userRef);
        const currentVenueId = userSnap.exists ? ((_a = userSnap.data().venueId) !== null && _a !== void 0 ? _a : null) : null;
        if (currentVenueId) {
            throw new functions.https.HttpsError("failed-precondition", "This user is already attached to a venue.");
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        // 1) Venue document
        tx.set(venueRef, {
            venueId,
            name,
            createdAt: now,
            ownerUid: uid,
            ownerEmail: email,
            openSignup: false,
            dev: false,
        }, { merge: true });
        // 2) Member document (owner)
        tx.set(memberRef, {
            uid,
            role: "owner",
            email,
            joinedAt: now,
            status: "active",
        }, { merge: true });
        // 3) User document – what VenueProvider reads
        tx.set(userRef, {
            email,
            venueId,
            touchedAt: now,
        }, { merge: true });
    });
    return { venueId };
});
//# sourceMappingURL=venueCreate.js.map