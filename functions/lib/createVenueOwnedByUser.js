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
const ensureVenueDefaults_1 = require("./ensureVenueDefaults");
// Helper: generate a v_ style venue id similar to your existing ones
function generateVenueId() {
    const autoId = admin.firestore().collection("_tmp").doc().id; // random 20-char id
    return autoId.startsWith("v_") ? autoId : `v_${autoId}`;
}
exports.createVenueOwnedByUser = functions
    .region("australia-southeast1")
    .https.onRequest(async (req, res) => {
    try {
        // Accept both GET and POST, but prefer POST with JSON body.
        const method = req.method.toUpperCase();
        let name;
        let uid;
        let email;
        if (method === "GET") {
            name = req.query.name ?? undefined;
            uid = req.query.uid ?? undefined;
            email = req.query.email ?? undefined;
        }
        else if (method === "POST") {
            const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
            name = typeof body.name === "string" ? body.name : undefined;
            uid = typeof body.uid === "string" ? body.uid : undefined;
            email = typeof body.email === "string" ? body.email : undefined;
        }
        else {
            res.status(405).send("Method not allowed");
            return;
        }
        const trimmedName = (name || "").trim();
        if (!trimmedName) {
            res.status(400).send("Missing venue name");
            return;
        }
        if (!uid) {
            res.status(400).send("Missing uid");
            return;
        }
        const db = admin.firestore();
        const venueId = generateVenueId();
        const now = admin.firestore.FieldValue.serverTimestamp();
        const venueRef = db.collection("venues").doc(venueId);
        const memberRef = venueRef.collection("members").doc(uid);
        const userRef = db.collection("users").doc(uid);
        await db.runTransaction(async (tx) => {
            // 1) Venue root
            tx.set(venueRef, {
                venueId,
                name: trimmedName,
                createdAt: now,
                ownerUid: uid,
                ownerEmail: email ?? null,
                openSignup: false,
                dev: false,
            }, { merge: true });
            // 2) Member doc (owner)
            tx.set(memberRef, {
                uid,
                role: "owner",
                email: email ?? null,
                joinedAt: now,
            }, { merge: true });
            // 3) User doc – this is what your VenueProvider watches (venueId)
            tx.set(userRef, {
                uid,
                email: email ?? null,
                venueId,
                updatedAt: now,
            }, { merge: true });
        });
        console.log("[createVenueOwnedByUser] created", { uid, venueId, name: trimmedName });
        // Ensure server-owned defaults exist (idempotent).
        await (0, ensureVenueDefaults_1.ensureVenueDefaults)(venueId, uid);
        res.status(200).json({ ok: true, venueId });
    }
    catch (err) {
        console.error("[createVenueOwnedByUser] error", err);
        res.status(500).send("Internal error");
    }
});
//# sourceMappingURL=createVenueOwnedByUser.js.map