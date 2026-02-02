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
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
if (!admin.apps.length)
    admin.initializeApp();
exports.uploadShelfScanPhotoCallable = (0, https_1.onCall)({ region: "us-central1" }, async (request) => {
    try {
        console.log("uploadShelfScanPhotoCallable INVOKED");
        const { data, auth } = request;
        const uid = auth?.uid;
        if (!uid) {
            throw new https_1.HttpsError("unauthenticated", "Sign in required.");
        }
        const venueId = String(data?.venueId || "").trim();
        const scanId = String(data?.scanId || "").trim();
        const contentType = String(data?.contentType || "image/jpeg");
        console.log("UPLOAD PAYLOAD KEYS:", Object.keys(data || {}));
        console.log("base64 type/len:", typeof data?.base64, data?.base64?.length);
        if (!venueId)
            throw new https_1.HttpsError("invalid-argument", "Missing venueId.");
        if (!scanId)
            throw new https_1.HttpsError("invalid-argument", "Missing scanId.");
        let b64 = data?.base64;
        if (typeof b64 !== "string" || b64.length === 0) {
            throw new https_1.HttpsError("invalid-argument", "Missing/invalid base64");
        }
        // Strip data URL prefix if present
        b64 = b64.replace(/^data:.*;base64,/, "");
        const buf = Buffer.from(b64, "base64");
        console.log("DECODED BYTES:", buf.length);
        if (!buf.length) {
            throw new https_1.HttpsError("invalid-argument", "Decoded image empty.");
        }
        if (buf.length > 10 * 1024 * 1024) {
            throw new https_1.HttpsError("invalid-argument", "Image too large (max 10MB).");
        }
        const path = `uploads/${venueId}/shelf-scan/${uid}/${scanId}.jpg`;
        const bucket = admin.storage().bucket();
        console.log("ABOUT TO SAVE:", path);
        await bucket.file(path).save(buf, {
            resumable: false,
            metadata: { contentType },
        });
        console.log("UPLOAD SAVED:", path, "bytes=", buf.length);
        const result = {
            ok: true,
            path,
            fullPath: path,
            bytes: buf.length,
            contentType,
        };
        console.log("UPLOAD DONE RETURNING:", result);
        return result;
    }
    catch (e) {
        console.error("UPLOAD FAILED:", e?.message || e, e?.stack || "");
        throw e instanceof https_1.HttpsError
            ? e
            : new https_1.HttpsError("internal", e?.message || "Upload failed");
    }
});
//# sourceMappingURL=uploadShelfScanPhotoCallable.js.map