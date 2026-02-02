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
exports.uploadShelfScanPhotoCallable = void 0;
// @ts-nocheck
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
if (!admin.apps.length) {
    admin.initializeApp();
}
exports.uploadShelfScanPhotoCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    try {
        const uid = request.auth?.uid;
        if (!uid)
            throw new https_1.HttpsError("unauthenticated", "Sign in required.");
        const data = request.data || {};
        const venueId = String(data?.venueId || "").trim();
        const scanId = String(data?.scanId || "").trim();
        let b64 = String(data?.b64 || "").trim();
        const contentType = String(data?.contentType || "image/jpeg").trim() || "image/jpeg";
        if (!venueId)
            throw new https_1.HttpsError("invalid-argument", "Missing venueId.");
        if (!scanId)
            throw new https_1.HttpsError("invalid-argument", "Missing scanId.");
        if (!b64)
            throw new https_1.HttpsError("invalid-argument", "Missing b64 payload.");
        // Strip data URL prefix if client sends it
        const m = b64.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.*)$/);
        if (m)
            b64 = m[2] || "";
        const buf = Buffer.from(b64, "base64");
        if (!buf?.length)
            throw new https_1.HttpsError("invalid-argument", "b64 decoded to empty buffer.");
        if (buf.length > 10 * 1024 * 1024)
            throw new https_1.HttpsError("invalid-argument", "Image too large (max 10MB).");
        const path = `uploads/${venueId}/shelf-scan/${uid}/${scanId}.jpg`;
        const bucket = admin.storage().bucket();
        const file = bucket.file(path);
        await file.save(buf, {
            resumable: false,
            metadata: { contentType, cacheControl: "private, max-age=3600" },
        });
        return { ok: true, fullPath: path, size: buf.length, contentType };
    }
    catch (e) {
        if (e instanceof https_1.HttpsError)
            throw e;
        const msg = e?.message || String(e);
        throw new https_1.HttpsError("internal", `uploadShelfScanPhotoCallable failed: ${msg}`, { raw: msg });
    }
});
//# sourceMappingURL=uploadShelfScanPhotoCallable.js.map