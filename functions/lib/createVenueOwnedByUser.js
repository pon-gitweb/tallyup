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
function getBearerToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || typeof authHeader !== "string")
        return null;
    const parts = authHeader.split(" ");
    if (parts.length !== 2)
        return null;
    if (parts[0] !== "Bearer")
        return null;
    return parts[1];
}
// Simple HTTPS endpoint that expects:
//   POST /createVenueOwnedByUser
//   headers: Authorization: Bearer <idToken>
//   body: { "name": "Venue Name" }
exports.createVenueOwnedByUser = functions
    .region("australia-southeast1")
    .https.onRequest(async (req, res) => {
    var _a, _b, _c, _d;
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    try {
        const token = getBearerToken(req);
        if (!token) {
            res.status(401).json({ error: "Missing or invalid Authorization header" });
            return;
        }
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = decoded.uid;
        const email = (_a = decoded.email) !== null && _a !== void 0 ? _a : null;
        const rawName = ((_c = (_b = req.body) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "").toString();
        const name = rawName.trim();
        if (!name) {
            res.status(400).json({ error: "Venue name is required." });
            return;
        }
        const db = admin.firestore();
        const venueId = `v_${(0, uuid_1.v4)().replace(/-/g, "").slice(0, 20)}`;
        const userRef = db.doc(`users/${uid}`);
        const venueRef = db.doc(`venues/${venueId}`);
        const memberRef = venueRef.collection("members").doc(uid);
        await db.runTransaction(async (tx) => {
            var _a, _b;
            const userSnap = await tx.get(userRef);
            const existingVenueId = userSnap.exists ? (_b = (_a = userSnap.data()) === null || _a === void 0 ? void 0 : _a.venueId) !== null && _b !== void 0 ? _b : null : null;
            if (existingVenueId) {
                throw new functions.https.HttpsError("failed-precondition", "User is already attached to a venue.");
            }
            const now = admin.firestore.FieldValue.serverTimestamp();
            // venues/{venueId}
            tx.set(venueRef, {
                venueId,
                name,
                createdAt: now,
                ownerUid: uid,
                ownerEmail: email,
                dev: false
            }, { merge: true });
            // venues/{venueId}/members/{uid}
            tx.set(memberRef, {
                uid,
                role: "owner",
                email,
                joinedAt: now
            }, { merge: true });
            // users/{uid}
            tx.set(userRef, {
                uid,
                email,
                venueId,
                venues: admin.firestore.FieldValue.arrayUnion(venueId),
                updatedAt: now
            }, { merge: true });
        });
        functions.logger.info("[createVenueOwnedByUser] created", { uid, venueId, name });
        res.status(200).json({ venueId });
    }
    catch (err) {
        functions.logger.error("[createVenueOwnedByUser] failed", {
            error: (_d = err === null || err === void 0 ? void 0 : err.message) !== null && _d !== void 0 ? _d : String(err)
        });
        if (err instanceof functions.https.HttpsError) {
            const code = err.code || "internal";
            const message = err.message || "Failed to create venue.";
            res.status(code === "failed-precondition" ? 412 : 500).json({ error: message });
            return;
        }
        res.status(500).json({ error: "Failed to create venue." });
    }
});
//# sourceMappingURL=createVenueOwnedByUser.js.map