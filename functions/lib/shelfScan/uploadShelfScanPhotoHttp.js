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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadShelfScanPhotoHttp = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const busboy_1 = __importDefault(require("busboy"));
function json(res, code, body) {
    res.status(code).set("content-type", "application/json").send(JSON.stringify(body));
}
async function isVenueMember(venueId, uid, decoded) {
    // Fast path: custom claim venues map
    if (decoded?.venues?.[venueId] === true)
        return true;
    // Fallback: membership doc exists
    const snap = await admin
        .firestore()
        .doc(`venues/${venueId}/members/${uid}`)
        .get();
    return snap.exists;
}
// POST multipart/form-data:
// fields: venueId, scanId
// file:   file (image)
exports.uploadShelfScanPhotoHttp = (0, https_1.onRequest)({ region: "us-central1", cors: true }, async (req, res) => {
    try {
        if (req.method !== "POST")
            return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
        const authHeader = req.headers.authorization || "";
        const m = authHeader.match(/^Bearer (.+)$/i);
        if (!m)
            return json(res, 401, { ok: false, error: "MISSING_AUTH" });
        const idToken = m[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        const uid = decoded?.uid;
        if (!uid)
            return json(res, 401, { ok: false, error: "BAD_TOKEN" });
        const bb = (0, busboy_1.default)({ headers: req.headers });
        let venueId = "";
        let scanId = "";
        let fileBuffer = null;
        let fileMime = "image/jpeg";
        bb.on("field", (name, val) => {
            if (name === "venueId")
                venueId = String(val || "");
            if (name === "scanId")
                scanId = String(val || "");
        });
        bb.on("file", (_name, file, info) => {
            fileMime = info?.mimeType || fileMime;
            const chunks = [];
            file.on("data", (d) => chunks.push(d));
            file.on("end", () => {
                fileBuffer = Buffer.concat(chunks);
            });
        });
        bb.on("error", (e) => {
            throw e;
        });
        bb.on("finish", async () => {
            try {
                if (!venueId)
                    return json(res, 400, { ok: false, error: "MISSING_VENUE" });
                if (!scanId)
                    return json(res, 400, { ok: false, error: "MISSING_SCANID" });
                if (!fileBuffer || fileBuffer.length === 0)
                    return json(res, 400, { ok: false, error: "MISSING_FILE" });
                const ok = await isVenueMember(venueId, uid, decoded);
                if (!ok)
                    return json(res, 403, { ok: false, error: "NOT_VENUE_MEMBER" });
                // Write to Storage via Admin
                const bucket = admin.storage().bucket();
                const fullPath = `uploads/${venueId}/shelf-scan/${uid}/${scanId}.jpg`;
                const f = bucket.file(fullPath);
                await f.save(fileBuffer, {
                    resumable: false,
                    contentType: fileMime || "image/jpeg",
                    metadata: {
                        cacheControl: "public,max-age=3600",
                    },
                });
                // Signed URL for debugging / optional UI preview
                const [downloadUrl] = await f.getSignedUrl({
                    action: "read",
                    expires: Date.now() + 1000 * 60 * 60, // 1 hour
                });
                return json(res, 200, { ok: true, fullPath, downloadUrl });
            }
            catch (e) {
                return json(res, 500, { ok: false, error: e?.message ?? String(e) });
            }
        });
        req.pipe(bb);
    }
    catch (e) {
        return json(res, 500, { ok: false, error: e?.message ?? String(e) });
    }
});
//# sourceMappingURL=uploadShelfScanPhotoHttp.js.map