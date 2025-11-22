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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = OrderDetailScreen;
// @ts-nocheck
const react_1 = __importStar(require("react"));
const react_native_1 = require("react-native");
const native_1 = require("@react-navigation/native");
const VenueProvider_1 = require("../../context/VenueProvider");
const firestore_1 = require("firebase/firestore");
const DocumentPicker = __importStar(require("expo-document-picker"));
// ✅ Upload + parse helpers
const invoiceUpload_1 = require("../../services/invoices/invoiceUpload");
const processInvoicesCsv_1 = require("../../services/invoices/processInvoicesCsv");
const processInvoicesPdf_1 = require("../../services/invoices/processInvoicesPdf");
// ✅ New: persist reconciliation snapshots
const reconciliationStore_1 = require("../../services/invoices/reconciliationStore");
const ReceiveOptionsModal_1 = __importDefault(require("./receive/ReceiveOptionsModal"));
const ManualReceiveScreen_1 = __importDefault(require("./receive/ManualReceiveScreen"));
const receive_1 = require("../../services/orders/receive");
function tierForConfidence(c) {
    const x = Number.isFinite(c) ? Number(c) : -1;
    if (x >= 0.95)
        return 'high';
    if (x >= 0.80)
        return 'medium';
    return 'low';
}
// REST base (same pattern used elsewhere)
const API_BASE = (typeof process !== 'undefined' && ((_a = process.env) === null || _a === void 0 ? void 0 : _a.EXPO_PUBLIC_AI_URL))
    ? String(process.env.EXPO_PUBLIC_AI_URL).replace(/\/+$/, '')
    : 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
// Simple fetch JSON helper
async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) {
        const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
        throw new Error(msg);
    }
    return json;
}
// Reconcile against submitted order on the server (produces summary counts/totals)
async function reconcileOnServer(input) {
    const q = input.orderPo ? `?orderPo=${encodeURIComponent(input.orderPo)}` : '';
    const url = `${API_BASE}/api/reconcile-invoice${q}`;
    return postJson(url, {
        venueId: input.venueId,
        orderId: input.orderId,
        invoice: input.invoice,
        lines: input.lines,
    });
}
function OrderDetailScreen() {
    var _a;
    const nav = (0, native_1.useNavigation)();
    const route = (0, native_1.useRoute)();
    const venueId = (0, VenueProvider_1.useVenueId)();
    const orderId = (_a = route.params) === null || _a === void 0 ? void 0 : _a.orderId;
    const [orderMeta, setOrderMeta] = (0, react_1.useState)(null);
    const [lines, setLines] = (0, react_1.useState)([]);
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [receiveOpen, setReceiveOpen] = (0, react_1.useState)(false);
    const [manualOpen, setManualOpen] = (0, react_1.useState)(false);
    const [csvReview, setCsvReview] = (0, react_1.useState)(null);
    const [pdfReview, setPdfReview] = (0, react_1.useState)(null);
    const autoConfirmedRef = (0, react_1.useRef)(false);
    const db = (0, firestore_1.getFirestore)();
    (0, react_1.useEffect)(() => {
        let alive = true;
        (async () => {
            try {
                if (!venueId || !orderId)
                    return;
                const oSnap = await (0, firestore_1.getDoc)((0, firestore_1.doc)(db, 'venues', venueId, 'orders', orderId));
                const oVal = oSnap.exists() ? oSnap.data() : {};
                if (!alive)
                    return;
                setOrderMeta(Object.assign({ id: oSnap.id }, oVal));
                const linesSnap = await (0, firestore_1.getDocs)((0, firestore_1.collection)(db, 'venues', venueId, 'orders', orderId, 'lines'));
                const linesData = [];
                linesSnap.forEach((docSnap) => {
                    const d = docSnap.data() || {};
                    linesData.push({
                        id: docSnap.id,
                        productId: d.productId,
                        name: d.name,
                        qty: Number.isFinite(d.qty) ? Number(d.qty) : (d.qty || 0),
                        unitCost: Number.isFinite(d.unitCost) ? Number(d.unitCost) : (d.unitCost || 0),
                    });
                });
                setLines(linesData);
            }
            catch (e) {
                console.warn('[OrderDetail] load fail', e);
            }
            finally {
                if (alive)
                    setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [db, venueId, orderId]);
    // ---- Common: after we parse, always reconcile + persist (even if PO mismatch) ----
    const reconcileAndPersist = (0, react_1.useCallback)(async (kind, parsed) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const orderPo = String((_a = orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber) !== null && _a !== void 0 ? _a : '').trim() || null;
        // 1) Ask server to reconcile against submitted order snapshot
        const rec = await reconcileOnServer({
            venueId, orderId,
            invoice: { source: kind, storagePath: parsed.storagePath, poNumber: (_c = (_b = parsed.invoice) === null || _b === void 0 ? void 0 : _b.poNumber) !== null && _c !== void 0 ? _c : null },
            lines: parsed.lines || [],
            orderPo
        });
        // 2) Persist a Reconciliation doc so Reports/Variance can surface it
        try {
            await (0, reconciliationStore_1.persistAfterParse)({
                venueId, orderId,
                reconciliationId: rec.reconciliationId,
                invoice: { source: kind, storagePath: parsed.storagePath, poNumber: (_e = (_d = parsed.invoice) === null || _d === void 0 ? void 0 : _d.poNumber) !== null && _e !== void 0 ? _e : null },
                summary: rec.summary,
                // If server decides confidence later, we still store our local parse confidence now;
                // PO mismatch will be encoded in summary.poMatch=false and we keep confidence conservative in UI decisions.
                confidence: (_f = parsed.confidence) !== null && _f !== void 0 ? _f : null,
                warnings: parsed.warnings || ((_g = parsed.matchReport) === null || _g === void 0 ? void 0 : _g.warnings) || [],
            });
        }
        catch (e) {
            console.warn('[persistAfterParse] error', e);
        }
        return rec; // give caller a chance to branch on poMatch
    }, [venueId, orderId, orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber]);
    /** CSV: pick -> upload URI -> parse -> reconcile+persist -> optional PO guard -> stage review */
    const pickCsvAndProcess = (0, react_1.useCallback)(async () => {
        var _a, _b, _c, _d, _e;
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: 'text/csv', multiple: false, copyToCacheDirectory: true });
            if (res.canceled || !((_a = res.assets) === null || _a === void 0 ? void 0 : _a[0]))
                return;
            const a = res.assets[0];
            const uri = a.uri || a.file || '';
            const name = a.name || 'invoice.csv';
            if (!uri)
                throw new Error('No file uri from DocumentPicker');
            if (__DEV__)
                console.log('[Receive][CSV] picked', { uri, name });
            const up = await (0, invoiceUpload_1.uploadInvoiceCsv)(venueId, orderId, uri, name);
            if (__DEV__)
                console.log('[Receive][CSV] uploaded', up);
            const review = await (0, processInvoicesCsv_1.processInvoicesCsv)({ venueId, orderId, storagePath: up.fullPath });
            if (__DEV__)
                console.log('[Receive][CSV] processed', { lines: (_c = (_b = review === null || review === void 0 ? void 0 : review.lines) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0 });
            const parsed = {
                storagePath: up.fullPath,
                confidence: review === null || review === void 0 ? void 0 : review.confidence,
                warnings: review === null || review === void 0 ? void 0 : review.warnings,
                lines: (review === null || review === void 0 ? void 0 : review.lines) || [],
                invoice: { source: 'csv', storagePath: up.fullPath, poNumber: (_e = (_d = review === null || review === void 0 ? void 0 : review.invoice) === null || _d === void 0 ? void 0 : _d.poNumber) !== null && _e !== void 0 ? _e : null },
                matchReport: review === null || review === void 0 ? void 0 : review.matchReport
            };
            // Reconcile+persist (records even when PO mismatches)
            const rec = await reconcileAndPersist('csv', parsed);
            // If PO mismatch: soft-reject (but we already persisted the snapshot)
            if ((rec === null || rec === void 0 ? void 0 : rec.summary) && rec.summary.poMatch === false) {
                react_native_1.Alert.alert('PO mismatch', `Invoice PO (${parsed.invoice.poNumber || '—'}) does not match order PO (${(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber) || '—'}).\nA reconciliation snapshot was saved.\nUse Manual Receive to proceed.`, [{ text: 'OK' }, { text: 'Manual Receive', onPress: () => setManualOpen(true) }]);
                return;
            }
            // Otherwise stage the normal CSV review
            setCsvReview(Object.assign(Object.assign({}, review), { storagePath: up.fullPath }));
            setReceiveOpen(false);
        }
        catch (e) {
            console.error('[OrderDetail] csv pick/process fail', e);
            react_native_1.Alert.alert('Upload failed', String((e === null || e === void 0 ? void 0 : e.message) || e));
        }
    }, [venueId, orderId, orderMeta, reconcileAndPersist]);
    /** PDF: pick -> upload URI -> parse -> reconcile+persist -> optional PO guard -> stage review */
    const pickPdfAndUpload = (0, react_1.useCallback)(async () => {
        var _a, _b, _c, _d, _e;
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: false, copyToCacheDirectory: true });
            if (res.canceled || !((_a = res.assets) === null || _a === void 0 ? void 0 : _a[0]))
                return;
            const a = res.assets[0];
            const uri = a.uri || a.file || '';
            const name = a.name || 'invoice.pdf';
            if (!uri)
                throw new Error('No file uri from DocumentPicker');
            if (__DEV__)
                console.log('[Receive][PDF] picked', { uri, name });
            const up = await (0, invoiceUpload_1.uploadInvoicePdf)(venueId, orderId, uri, name);
            if (__DEV__)
                console.log('[Receive][PDF] uploaded', up);
            const parsedPdf = await (0, processInvoicesPdf_1.processInvoicesPdf)({ venueId, orderId, storagePath: up.fullPath });
            if (__DEV__)
                console.log('[Receive][PDF] processed', { lines: (_c = (_b = parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.lines) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0 });
            const parsed = {
                storagePath: up.fullPath,
                confidence: parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.confidence,
                warnings: parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.warnings,
                lines: (parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.lines) || [],
                invoice: { source: 'pdf', storagePath: up.fullPath, poNumber: (_e = (_d = parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.invoice) === null || _d === void 0 ? void 0 : _d.poNumber) !== null && _e !== void 0 ? _e : null },
                matchReport: parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.matchReport
            };
            const rec = await reconcileAndPersist('pdf', parsed);
            if ((rec === null || rec === void 0 ? void 0 : rec.summary) && rec.summary.poMatch === false) {
                react_native_1.Alert.alert('PO mismatch', `Invoice PO (${parsed.invoice.poNumber || '—'}) does not match order PO (${(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber) || '—'}).\nA reconciliation snapshot was saved.\nUse Manual Receive to proceed.`, [{ text: 'OK' }, { text: 'Manual Receive', onPress: () => setManualOpen(true) }]);
                return;
            }
            setPdfReview(Object.assign(Object.assign({}, parsedPdf), { storagePath: up.fullPath }));
            setReceiveOpen(false);
        }
        catch (e) {
            console.error('[OrderDetail] pdf upload/parse fail', e);
            react_native_1.Alert.alert('Upload failed', String((e === null || e === void 0 ? void 0 : e.message) || e));
        }
    }, [venueId, orderId, orderMeta, reconcileAndPersist]);
    /** Unified file picker routes */
    const pickFileAndRoute = (0, react_1.useCallback)(async () => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        try {
            const res = await DocumentPicker.getDocumentAsync({
                type: ['application/pdf', 'text/csv', 'text/comma-separated-values', 'text/plain'],
                multiple: false, copyToCacheDirectory: true
            });
            if (res.canceled || !((_a = res.assets) === null || _a === void 0 ? void 0 : _a[0]))
                return;
            const a = res.assets[0];
            const name = (a.name || '').toLowerCase();
            const uri = a.uri || a.file || '';
            if (!uri)
                throw new Error('No file uri from DocumentPicker');
            const isPdf = name.endsWith('.pdf');
            const isCsv = isPdf ? false : (name.endsWith('.csv') || name.endsWith('.txt'));
            if (__DEV__)
                console.log('[Receive][FILE] picked', { uri, name, isPdf, isCsv });
            if (isPdf) {
                const up = await (0, invoiceUpload_1.uploadInvoicePdf)(venueId, orderId, uri, a.name || 'invoice.pdf');
                if (__DEV__)
                    console.log('[Receive][FILE][PDF] uploaded', up);
                const parsedPdf = await (0, processInvoicesPdf_1.processInvoicesPdf)({ venueId, orderId, storagePath: up.fullPath });
                if (__DEV__)
                    console.log('[Receive][FILE][PDF] processed', { lines: (_c = (_b = parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.lines) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0 });
                const parsed = {
                    storagePath: up.fullPath,
                    confidence: parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.confidence,
                    warnings: parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.warnings,
                    lines: (parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.lines) || [],
                    invoice: { source: 'pdf', storagePath: up.fullPath, poNumber: (_e = (_d = parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.invoice) === null || _d === void 0 ? void 0 : _d.poNumber) !== null && _e !== void 0 ? _e : null },
                    matchReport: parsedPdf === null || parsedPdf === void 0 ? void 0 : parsedPdf.matchReport
                };
                const rec = await reconcileAndPersist('pdf', parsed);
                if ((rec === null || rec === void 0 ? void 0 : rec.summary) && rec.summary.poMatch === false) {
                    react_native_1.Alert.alert('PO mismatch', `Invoice PO (${parsed.invoice.poNumber || '—'}) does not match order PO (${(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber) || '—'}).\nA reconciliation snapshot was saved.\nUse Manual Receive to proceed.`, [{ text: 'OK' }, { text: 'Manual Receive', onPress: () => setManualOpen(true) }]);
                    return;
                }
                setPdfReview(Object.assign(Object.assign({}, parsedPdf), { storagePath: up.fullPath }));
                setReceiveOpen(false);
                return;
            }
            if (isCsv) {
                const up = await (0, invoiceUpload_1.uploadInvoiceCsv)(venueId, orderId, uri, a.name || 'invoice.csv');
                if (__DEV__)
                    console.log('[Receive][FILE][CSV] uploaded', up);
                const review = await (0, processInvoicesCsv_1.processInvoicesCsv)({ venueId, orderId, storagePath: up.fullPath });
                if (__DEV__)
                    console.log('[Receive][FILE][CSV] processed', { lines: (_g = (_f = review === null || review === void 0 ? void 0 : review.lines) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0 });
                const parsed = {
                    storagePath: up.fullPath,
                    confidence: review === null || review === void 0 ? void 0 : review.confidence,
                    warnings: review === null || review === void 0 ? void 0 : review.warnings,
                    lines: (review === null || review === void 0 ? void 0 : review.lines) || [],
                    invoice: { source: 'csv', storagePath: up.fullPath, poNumber: (_j = (_h = review === null || review === void 0 ? void 0 : review.invoice) === null || _h === void 0 ? void 0 : _h.poNumber) !== null && _j !== void 0 ? _j : null },
                    matchReport: review === null || review === void 0 ? void 0 : review.matchReport
                };
                const rec = await reconcileAndPersist('csv', parsed);
                if ((rec === null || rec === void 0 ? void 0 : rec.summary) && rec.summary.poMatch === false) {
                    react_native_1.Alert.alert('PO mismatch', `Invoice PO (${parsed.invoice.poNumber || '—'}) does not match order PO (${(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber) || '—'}).\nA reconciliation snapshot was saved.\nUse Manual Receive to proceed.`, [{ text: 'OK' }, { text: 'Manual Receive', onPress: () => setManualOpen(true) }]);
                    return;
                }
                setCsvReview(Object.assign(Object.assign({}, review), { storagePath: up.fullPath }));
                setReceiveOpen(false);
                return;
            }
            react_native_1.Alert.alert('Unsupported file', 'Please choose a PDF or CSV invoice.');
        }
        catch (e) {
            console.error('[OrderDetail] file pick route fail', e);
            react_native_1.Alert.alert('Upload failed', String((e === null || e === void 0 ? void 0 : e.message) || e));
        }
    }, [venueId, orderId, orderMeta, reconcileAndPersist]);
    const ConfidenceBanner = ({ kind, score }) => {
        const t = tierForConfidence(score);
        const msg = t === 'low' ? 'Low confidence: results may be inaccurate. Consider Manual Receive.'
            : t === 'medium' ? 'Medium confidence: please review carefully before confirming.'
                : 'High confidence: looks good.';
        const bg = t === 'low' ? '#FEF3C7' : t === 'medium' ? '#E0E7FF' : '#DCFCE7';
        const fg = t === 'low' ? '#92400E' : t === 'medium' ? '#1E3A8A' : '#065F46';
        return (<react_native_1.View style={{ backgroundColor: bg, padding: 10, borderRadius: 8, marginBottom: 10 }}>
        <react_native_1.Text style={{ color: fg, fontWeight: '700' }}>{msg} {Number.isFinite(score) ? `(confidence ${(score * 100).toFixed(0)}%)` : ''}</react_native_1.Text>
        {t === 'low' ? (<react_native_1.TouchableOpacity onPress={() => setManualOpen(true)} style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: '#111', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 }}>
            <react_native_1.Text style={{ color: '#fff', fontWeight: '700' }}>Open Manual Receive</react_native_1.Text>
          </react_native_1.TouchableOpacity>) : null}
      </react_native_1.View>);
    };
    // Auto-confirm CSV on very high confidence (unchanged)
    (0, react_1.useEffect)(() => {
        if (!csvReview || autoConfirmedRef.current)
            return;
        const t = tierForConfidence(csvReview.confidence);
        if (t === 'high') {
            autoConfirmedRef.current = true;
            (async () => {
                try {
                    await (0, receive_1.finalizeReceiveFromCsv)({
                        venueId,
                        orderId,
                        parsed: {
                            invoice: csvReview.invoice,
                            lines: csvReview.lines,
                            matchReport: csvReview.matchReport,
                            confidence: csvReview.confidence,
                            warnings: csvReview.warnings
                        }
                    });
                    react_native_1.Alert.alert('Received', 'High-confidence invoice auto-accepted and posted.');
                    setReceiveOpen(false);
                    setCsvReview(null);
                    nav.goBack();
                }
                catch (e) {
                    autoConfirmedRef.current = false;
                    react_native_1.Alert.alert('Auto-receive failed', String((e === null || e === void 0 ? void 0 : e.message) || e));
                }
            })();
        }
    }, [csvReview, venueId, orderId, nav]);
    const totalOrdered = (0, react_1.useMemo)(() => {
        return lines.reduce((sum, line) => {
            const cost = line.unitCost || 0;
            const qty = line.qty || 0;
            return sum + (cost * qty);
        }, 0);
    }, [lines]);
    const csvWarnings = (0, react_1.useMemo)(() => {
        var _a;
        if (!csvReview)
            return [];
        return (csvReview.warnings || ((_a = csvReview.matchReport) === null || _a === void 0 ? void 0 : _a.warnings) || []);
    }, [csvReview]);
    const pdfWarnings = (0, react_1.useMemo)(() => {
        var _a;
        if (!pdfReview)
            return [];
        return (pdfReview.warnings || ((_a = pdfReview.matchReport) === null || _a === void 0 ? void 0 : _a.warnings) || []);
    }, [pdfReview]);
    if (loading)
        return <react_native_1.View style={S.loading}><react_native_1.ActivityIndicator /></react_native_1.View>;
    return (<react_native_1.View style={S.wrap}>
      <react_native_1.View style={S.top}>
        <react_native_1.View>
          <react_native_1.Text style={S.title}>{(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.supplierName) || 'Order'}</react_native_1.Text>
          <react_native_1.Text style={S.meta}>
            {(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.status) ? `Status: ${orderMeta.status}` : ''}{(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.poNumber) ? ` • PO: ${orderMeta.poNumber}` : ''}
          </react_native_1.Text>
        </react_native_1.View>
        {String(orderMeta === null || orderMeta === void 0 ? void 0 : orderMeta.status).toLowerCase() === 'submitted' ? (<react_native_1.TouchableOpacity style={[S.receiveBtn, { position: 'absolute', right: 16, bottom: 16, zIndex: 10, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4 }]} onPress={() => setReceiveOpen(true)}>
            <react_native_1.Text style={S.receiveBtnText}>Receive</react_native_1.Text>
          </react_native_1.TouchableOpacity>) : null}
      </react_native_1.View>

      {csvReview ? (<react_native_1.ScrollView style={{ flex: 1 }}>
          <react_native_1.View style={{ padding: 16 }}>
            <ConfidenceBanner kind="csv" score={csvReview.confidence}/>
            <react_native_1.Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8 }}>Review Invoice (CSV)</react_native_1.Text>
            {csvWarnings.length > 0 ? (<react_native_1.View style={{ marginBottom: 8 }}>
                {csvWarnings.map((w, idx) => (<react_native_1.Text key={idx} style={{ color: '#92400E' }}>• {w}</react_native_1.Text>))}
              </react_native_1.View>) : null}
            {(csvReview.lines || []).slice(0, 40).map((pl, idx) => {
                var _a;
                return (<react_native_1.View key={idx} style={{ paddingVertical: 6, borderBottomWidth: react_native_1.StyleSheet.hairlineWidth, borderColor: '#E5E7EB' }}>
                <react_native_1.Text style={{ fontWeight: '700' }}>{pl.name || pl.code || '(line)'}</react_native_1.Text>
                <react_native_1.Text style={{ color: '#6B7280' }}>Qty: {pl.qty} • Unit: ${((_a = pl.unitPrice) === null || _a === void 0 ? void 0 : _a.toFixed(2)) || '0.00'}</react_native_1.Text>
              </react_native_1.View>);
            })}
            {(csvReview.lines || []).length > 40 ? <react_native_1.Text style={{ marginTop: 8, color: '#6B7280' }}>... and {csvReview.lines.length - 40} more lines</react_native_1.Text> : null}

            <react_native_1.View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <react_native_1.TouchableOpacity style={{ flex: 1, paddingVertical: 12, backgroundColor: '#F3F4F6', borderRadius: 8 }} onPress={() => setCsvReview(null)}>
                <react_native_1.Text style={{ textAlign: 'center', fontWeight: '700', color: '#374151' }}>Cancel</react_native_1.Text>
              </react_native_1.TouchableOpacity>
              <react_native_1.TouchableOpacity style={{ flex: 1, paddingVertical: 12, backgroundColor: '#111827', borderRadius: 8 }} onPress={async () => {
                autoConfirmedRef.current = true;
                try {
                    await (0, receive_1.finalizeReceiveFromCsv)({
                        venueId,
                        orderId,
                        parsed: {
                            invoice: csvReview.invoice,
                            lines: csvReview.lines,
                            matchReport: csvReview.matchReport,
                            confidence: csvReview.confidence,
                            warnings: csvReview.warnings
                        }
                    });
                    react_native_1.Alert.alert('Received', 'Invoice posted and order marked received.');
                    setReceiveOpen(false);
                    setCsvReview(null);
                    nav.goBack();
                }
                catch (e) {
                    autoConfirmedRef.current = false;
                    react_native_1.Alert.alert('Receive failed', String((e === null || e === void 0 ? void 0 : e.message) || e));
                }
            }}>
                <react_native_1.Text style={{ textAlign: 'center', fontWeight: '700', color: '#fff' }}>Confirm & Post</react_native_1.Text>
              </react_native_1.TouchableOpacity>
            </react_native_1.View>
          </react_native_1.View>
        </react_native_1.ScrollView>) : pdfReview ? (<react_native_1.ScrollView style={{ flex: 1 }}>
          <react_native_1.View style={{ padding: 16 }}>
            <ConfidenceBanner kind="pdf" score={pdfReview.confidence}/>
            <react_native_1.Text style={{ fontSize: 16, fontWeight: '800', marginBottom: 8 }}>Review Invoice (PDF)</react_native_1.Text>
            {pdfWarnings.length > 0 ? (<react_native_1.View style={{ marginBottom: 8 }}>
                {pdfWarnings.map((w, idx) => (<react_native_1.Text key={idx} style={{ color: '#92400E' }}>• {w}</react_native_1.Text>))}
              </react_native_1.View>) : null}
            {(pdfReview.lines || []).slice(0, 40).map((pl, idx) => {
                var _a;
                return (<react_native_1.View key={idx} style={{ paddingVertical: 6, borderBottomWidth: react_native_1.StyleSheet.hairlineWidth, borderColor: '#E5E7EB' }}>
                <react_native_1.Text style={{ fontWeight: '700' }}>{pl.name || pl.code || '(line)'}</react_native_1.Text>
                <react_native_1.Text style={{ color: '#6B7280' }}>Qty: {pl.qty} • Unit: ${((_a = pl.unitPrice) === null || _a === void 0 ? void 0 : _a.toFixed(2)) || '0.00'}</react_native_1.Text>
              </react_native_1.View>);
            })}
            {(pdfReview.lines || []).length > 40 ? <react_native_1.Text style={{ marginTop: 8, color: '#6B7280' }}>... and {pdfReview.lines.length - 40} more lines</react_native_1.Text> : null}

            <react_native_1.View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <react_native_1.TouchableOpacity style={{ flex: 1, paddingVertical: 12, backgroundColor: '#F3F4F6', borderRadius: 8 }} onPress={() => setPdfReview(null)}>
                <react_native_1.Text style={{ textAlign: 'center', fontWeight: '700', color: '#374151' }}>Cancel</react_native_1.Text>
              </react_native_1.TouchableOpacity>
              <react_native_1.TouchableOpacity style={{ flex: 1, paddingVertical: 12, backgroundColor: '#111827', borderRadius: 8 }} onPress={() => {
                react_native_1.Alert.alert('Pending', 'PDF posting not wired to finalize yet.');
            }}>
                <react_native_1.Text style={{ textAlign: 'center', fontWeight: '700', color: '#fff' }}>Confirm (stub)</react_native_1.Text>
              </react_native_1.TouchableOpacity>
            </react_native_1.View>
          </react_native_1.View>
        </react_native_1.ScrollView>) : (<react_native_1.View style={{ flex: 1 }}>
          <react_native_1.FlatList data={lines} keyExtractor={(it) => it.id} contentContainerStyle={{ padding: 16 }} ItemSeparatorComponent={() => <react_native_1.View style={{ height: 8 }}/>} renderItem={({ item }) => {
                var _a;
                return (<react_native_1.View style={S.line}>
                <react_native_1.Text style={{ fontWeight: '700' }}>{item.name || item.productId || item.id}</react_native_1.Text>
                <react_native_1.Text style={{ color: '#6B7280' }}>Qty: {(_a = item.qty) !== null && _a !== void 0 ? _a : 0} • Unit: ${Number(item.unitCost || 0).toFixed(2)}</react_native_1.Text>
              </react_native_1.View>);
            }} ListHeaderComponent={(<react_native_1.View style={{ paddingBottom: 8 }}>
                <react_native_1.Text style={{ fontSize: 16, fontWeight: '800' }}>Order Lines</react_native_1.Text>
                <react_native_1.Text style={{ color: '#6B7280' }}>Estimated total: ${totalOrdered.toFixed(2)}</react_native_1.Text>
              </react_native_1.View>)}/>
        </react_native_1.View>)}

      <ReceiveOptionsModal_1.default visible={receiveOpen} onClose={() => setReceiveOpen(false)} orderId={orderId} orderLines={lines} onCsvSelected={pickCsvAndProcess} onPdfSelected={pickPdfAndUpload} onFileSelected={pickFileAndRoute} onManualSelected={() => setManualOpen(true)}/>

      <react_native_1.Modal visible={manualOpen} animationType="slide" onRequestClose={() => setManualOpen(false)}>
        <ManualReceiveScreen_1.default orderId={orderId} onClose={() => setManualOpen(false)}/>
      </react_native_1.Modal>
    </react_native_1.View>);
}
const S = react_native_1.StyleSheet.create({
    wrap: { flex: 1, backgroundColor: '#fff' },
    top: { padding: 16, borderBottomWidth: react_native_1.StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
    title: { fontSize: 20, fontWeight: '800' },
    meta: { marginTop: 4, color: '#6B7280' },
    line: { padding: 12, backgroundColor: '#F9FAFB', borderRadius: 10 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    receiveBtn: { backgroundColor: '#111', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
    receiveBtnText: { color: '#fff', fontWeight: '800' },
});
//# sourceMappingURL=OrderDetailScreen.js.map