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
exports.ocrFastReceivePhoto = exports.onOcrJobQueued = exports.refreshMyClaims = exports.onMemberWrite = void 0;
const admin = __importStar(require("firebase-admin"));
// Initialize Admin exactly once (safe on hot-reload)
try {
    admin.app();
}
catch {
    admin.initializeApp();
}
// === Membership (claims sync + callable) ===
var membership_1 = require("./membership");
Object.defineProperty(exports, "onMemberWrite", { enumerable: true, get: function () { return membership_1.onMemberWrite; } });
Object.defineProperty(exports, "refreshMyClaims", { enumerable: true, get: function () { return membership_1.refreshMyClaims; } });
var parseInvoice_1 = require("./ocr/parseInvoice");
Object.defineProperty(exports, "onOcrJobQueued", { enumerable: true, get: function () { return parseInvoice_1.onOcrJobQueued; } });
// === OCR callable ===
var ocrFastReceivePhoto_1 = require("./ocrFastReceivePhoto");
Object.defineProperty(exports, "ocrFastReceivePhoto", { enumerable: true, get: function () { return ocrFastReceivePhoto_1.ocrFastReceivePhoto; } });
