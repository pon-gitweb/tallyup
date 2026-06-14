// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDocs, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { apiBase } from '../../services/apiBase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { generatePurchasingPrediction, guessCategory } from '../../services/festival/purchasingPrediction';
import type { AiRefinement, AiAdjustment } from '../../services/festival/predictionRefinement';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';
import { useIsActivated } from '../../hooks/useIsActivated';
import PaywallBlurOverlay from '../../components/paywall/PaywallBlurOverlay';

// ─── Category mapping: setup screen IDs → prediction service categories ────────

const SETUP_TO_PRED: Record<string, string> = {
  beer_cans:     'beer',
  beer_draught:  'beer',
  wine_still:    'wine',
  wine_sparkling:'wine',
  spirits:       'spirits',
  rtd:           'rtd',
  cider:         'rtd',
  non_alcoholic: 'na',
  cocktails:     'spirits',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(v) {
  if (v == null) return '—';
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function confidenceColor(confidence, colours) {
  if (confidence === 'HIGH')   return colours.success;
  if (confidence === 'MEDIUM') return colours.stellarAmber;
  return colours.error;
}

function calcEventDays(startStr, endStr) {
  if (!startStr || !endStr) return 1;
  try {
    const [ds, ms, ys] = startStr.split('/').map(Number);
    const [de, me, ye] = endStr.split('/').map(Number);
    const diff = new Date(ye, me - 1, de).getTime() - new Date(ys, ms - 1, ds).getTime();
    return Math.max(1, Math.round(diff / 86400000) + 1);
  } catch { return 1; }
}

function formatShortDate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const [d, m, y] = ddmmyyyy.split('/');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] || ''} ${y}`;
}

// ─── Per-product row ──────────────────────────────────────────────────────────

function ProductRow({ result, sellingPrice, onQtyChange, onSellPriceChange, aiAdjustment, mathQtyDisplay, aiQtyDisplay, useAi, onToggleAi, colours, R }) {
  const displayQty = result.totalQty ?? result.predictedQty;
  const [qtyText, setQtyText] = useState(String(displayQty));
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    setQtyText(String(result.totalQty ?? result.predictedQty));
  }, [result.totalQty, result.predictedQty]);

  function commitQty() {
    const val = parseInt(qtyText, 10);
    if (!isNaN(val) && val > 0) onQtyChange(result.productId, val);
    else setQtyText(String(result.totalQty ?? result.predictedQty));
  }

  const currentQty = parseInt(qtyText, 10) || 0;
  const sellNum    = parseFloat(sellingPrice) || null;
  const cost       = result.unitCost;
  const estCost    = cost != null ? cost * currentQty : null;
  const estRev     = sellNum != null ? sellNum * currentQty : null;
  const gpPct      = sellNum != null && cost != null && sellNum > 0
    ? Math.round(((sellNum - cost) / sellNum) * 100)
    : null;
  const maxReturn  = Math.floor(currentQty * result.returnAllowancePercent / 100);
  const gpColor    = gpPct == null ? colours.slateMid
    : gpPct >= 60 ? colours.success : gpPct >= 40 ? colours.stellarAmber : colours.error;

  return (
    <View style={R.prodRow}>
      {/* Header */}
      <View style={R.prodTop}>
        <Text style={R.prodName} numberOfLines={2}>{result.productName}</Text>
        <View style={[R.confBadge, { borderColor: confidenceColor(result.confidence, colours) }]}>
          <Text style={[R.confText, { color: confidenceColor(result.confidence, colours) }]}>
            {result.confidence}
          </Text>
        </View>
      </View>
      <Text style={R.basisText}>
        {result.basis === 'prior_year' ? 'Prior year data' : 'Category benchmark'}
        {result.obligationAdjusted ? ' · obligation adjusted' : ''}
      </Text>

      {/* Qty breakdown */}
      <View style={R.breakdownBox}>
        <View style={R.bkRow}>
          <Text style={R.bkLabel}>Predicted ({result.basis === 'prior_year' ? 'prior year' : 'benchmark'}):</Text>
          <Text style={R.bkQty}>{result.bufferedQty}</Text>
        </View>
        {(result.riderQty || 0) > 0 && (
          <View style={R.bkRow}>
            <Text style={R.bkLabel}>+ Rider allocation:</Text>
            <Text style={R.bkQty}>{result.riderQty}</Text>
          </View>
        )}
        {(result.activationQty || 0) > 0 && (
          <View style={R.bkRow}>
            <Text style={R.bkLabel}>+ Activation stock:</Text>
            <Text style={R.bkQty}>{result.activationQty}</Text>
          </View>
        )}
        <View style={R.bkDivider} />
        <View style={R.bkRow}>
          <Text style={[R.bkLabel, { fontWeight: '700', color: colours.navy }]}>Total to order:</Text>
          <View style={R.stepperRow}>
            <TouchableOpacity
              style={R.stepperBtn}
              onPress={() => {
                const v = Math.max(1, currentQty - 1);
                setQtyText(String(v));
                onQtyChange(result.productId, v);
              }}
            >
              <Text style={R.stepperBtnText}>−</Text>
            </TouchableOpacity>
            <TextInput
              value={qtyText}
              onChangeText={setQtyText}
              onBlur={commitQty}
              keyboardType="number-pad"
              style={R.qtyInput}
              selectTextOnFocus
            />
            <TouchableOpacity
              style={R.stepperBtn}
              onPress={() => {
                const v = currentQty + 1;
                setQtyText(String(v));
                onQtyChange(result.productId, v);
              }}
            >
              <Text style={R.stepperBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={R.returnNote}>
          Max returnable ({result.returnAllowancePercent}%): {maxReturn} units
        </Text>
      </View>

      {/* Cost / sell / GP */}
      <View style={R.pricingBox}>
        {cost != null ? (
          <View style={R.pricingRow}>
            <Text style={R.pricingLbl}>Cost:</Text>
            <Text style={R.pricingVal}>
              ${cost.toFixed(2)}/unit → {estCost != null ? formatCurrency(estCost) : '—'}
            </Text>
          </View>
        ) : (
          <Text style={R.noCostWarn}>⚠ No cost price — add in Products</Text>
        )}
        <View style={R.pricingRow}>
          <Text style={R.pricingLbl}>Sell: $</Text>
          <TextInput
            value={sellingPrice}
            onChangeText={v => onSellPriceChange(result.productId, v)}
            placeholder="0.00"
            placeholderTextColor={colours.slateMid}
            keyboardType="decimal-pad"
            style={R.sellInput}
          />
          {estRev != null && (
            <Text style={R.pricingVal}> → {formatCurrency(estRev)}</Text>
          )}
        </View>
        {gpPct != null && (
          <View style={R.pricingRow}>
            <Text style={R.pricingLbl}>GP:</Text>
            <Text style={[R.gpText, { color: gpColor }]}>{gpPct}%</Text>
          </View>
        )}
      </View>

      {result.minimumCommitment != null && currentQty < result.minimumCommitment && (
        <Text style={R.commitWarn}>⚠ Min commitment: {result.minimumCommitment} units</Text>
      )}

      {/* AI comparison block — shown when refinement is active */}
      {aiAdjustment != null && mathQtyDisplay != null && aiQtyDisplay != null && (
        <View style={R.aiCompareBox}>
          <View style={R.aiCompareRow}>
            <Text style={[R.aiCompareLabel, !useAi && R.aiActiveLabel]}>Math: {mathQtyDisplay}</Text>
            <Text style={R.aiArrow}>→</Text>
            <Text style={[R.aiCompareLabel, useAi && R.aiActiveLabel]}>AI: {aiQtyDisplay}</Text>
          </View>
          <Text style={R.aiReasoning}>{aiAdjustment.reasoning}</Text>
          <View style={R.aiConfidenceRow}>
            <Text style={R.aiConfidence}>Confidence: {aiAdjustment.confidenceInAdjustment}</Text>
            <TouchableOpacity onPress={onToggleAi} style={R.aiToggleBtn}>
              <Text style={R.aiToggleBtnText}>{useAi ? 'Use math' : 'Use AI'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <TouchableOpacity onPress={() => setNotesOpen(v => !v)} style={R.notesToggle}>
        <Text style={R.notesToggleText}>
          {notesOpen ? '▲ Hide calculation' : '▼ How we calculated this'}
        </Text>
      </TouchableOpacity>
      {notesOpen && result.notes.map((n, i) => (
        <Text key={i} style={R.noteText}>• {n}</Text>
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalPurchasingPredictionScreen() {
  const nav     = useNavigation();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const { activated } = useIsActivated();
  const R = makeStyles(c);

  const [results,        setResults]        = useState([]);
  const [loading,        setLoading]        = useState(FESTIVAL_BETA);
  const [loadError,      setLoadError]      = useState(null);
  const [generating,     setGenerating]     = useState(false);
  const [eventData,      setEventData]      = useState(null);
  const [bufferPercent,  setBufferPercent]  = useState(15);
  const [sellingPrices,  setSellingPrices]  = useState({});
  // AI refinement state
  const [aiRefinement,   setAiRefinement]   = useState<AiRefinement | null>(null);
  const [refining,       setRefining]       = useState(false);
  const [refinementError,setRefinementError]= useState(null);
  const [useAiSuggestion,setUseAiSuggestion]= useState<Record<string, boolean>>({});
  const snapshotTimer = useRef(null);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    checkAndLoad();
  }, [venueId]);

  // ── Snapshot check on entry ───────────────────────────────────────────────

  async function checkAndLoad() {
    try {
      const snapDoc = await getDoc(doc(db, 'venues', venueId, 'event', 'predictionSnapshot'));
      if (snapDoc.exists()) {
        const snap = snapDoc.data();
        const ageMs = Date.now() - (snap.savedAt?.toMillis?.() || 0);
        if (ageMs < 86400000 && snap.results?.length > 0) {
          const ageHours = ageMs / 3600000;
          const label = ageHours < 1
            ? `${Math.round(ageMs / 60000)} min ago`
            : `${Math.round(ageHours)} hr ago`;
          // TODO: two meaningful action buttons (Load saved / Start fresh), not a confirm/cancel pair — kept as Alert.alert
          Alert.alert(
            'Load saved prediction?',
            `You have a saved prediction from ${label}. Load it or start fresh?`,
            [
              {
                text: 'Load saved',
                onPress: async () => {
                  setResults(snap.results);
                  if (snap.bufferUsed) setBufferPercent(snap.bufferUsed);
                  if (snap.sellingPrices) setSellingPrices(snap.sellingPrices);
                  const evSnap = await getDoc(doc(db, 'venues', venueId, 'event', 'details'));
                  setEventData(evSnap.exists() ? evSnap.data() : {});
                  setLoading(false);
                },
              },
              { text: 'Start fresh', onPress: () => runFullLoad(null) },
            ],
          );
          return;
        }
      }
    } catch {}
    runFullLoad(null);
  }

  // ── Full data load + prediction ───────────────────────────────────────────

  async function runFullLoad(overrideBuffer) {
    setLoading(true);
    setLoadError(null);
    try {
      // ── Parallelise all 5 Firestore reads (FIX 9) ──────────────────────────
      const [evSnap, prodSnap, oblSnapMaybe, ridersSnapMaybe, actSnapMaybe] =
        await Promise.all([
          getDoc(doc(db, 'venues', venueId, 'event', 'details')),
          getDocs(collection(db, 'venues', venueId, 'products')),
          getDocs(collection(db, 'venues', venueId, 'obligations')).catch(() => null),
          getDocs(collection(db, 'venues', venueId, 'riders')).catch(() => null),
          getDocs(collection(db, 'venues', venueId, 'activations')).catch(() => null),
        ]);

      // 1. Event details
      const event  = evSnap.exists() ? evSnap.data() : {};
      setEventData(event);
      const buf = overrideBuffer ?? bufferPercent;

      // 2. Products from venue catalogue
      const allProducts = prodSnap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name || d.id,
            category: data.category || guessCategory(data.name || ''),
            unitCost: data.costPrice ?? null,
            supplierId: data.supplierId || null,
            supplierName: data.supplierName || 'Unknown Supplier',
            caseSize: data.caseSize || null,
          };
        })
        .filter(p => p.supplierId); // products must have a supplier to be ordered

      // 3. Return allowances from supplier configs
      const supplierAllowances = {};
      Object.entries(event.supplierConfigs || {}).forEach(([sid, cfg]) => {
        supplierAllowances[sid] = cfg.returnAllowancePercent || 5;
      });

      // 4. Obligation minimums from contracts collection
      const obligationMins = {};
      if (oblSnapMaybe) {
        oblSnapMaybe.docs.forEach(d => {
          const obl = d.data();
          if (obl.type === 'minimum_volume' && obl.supplierName) {
            obligationMins[obl.supplierName] =
              (obligationMins[obl.supplierName] || 0) + (obl.quantity || 0);
          }
        });
      }

      // 5. Rider stock per product
      const riderStock = {};
      if (ridersSnapMaybe) {
        ridersSnapMaybe.docs.forEach(d => {
          (d.data().products || []).forEach(p => {
            riderStock[p.productId] = (riderStock[p.productId] || 0) + (p.quantity || 0);
          });
        });
      }

      // 6. Activation stock per product
      const activationStock = {};
      if (actSnapMaybe) {
        actSnapMaybe.docs.forEach(d => {
          (d.data().products || []).forEach(p => {
            activationStock[p.productId] = (activationStock[p.productId] || 0) + (p.quantity || 0);
          });
        });
      }

      // 7. Filter by active categories (FIX 8)
      const setupCats = event.categories || null;
      const activePredCats = setupCats
        ? [...new Set(setupCats.map(c => SETUP_TO_PRED[c] || 'na'))]
        : null;
      const filteredProducts = activePredCats
        ? allProducts.filter(p => activePredCats.includes(p.category))
        : allProducts;

      if (filteredProducts.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }

      // 8. Attach per-supplier return allowance to each product (FIX 1)
      const productsForPrediction = filteredProducts.map(p => ({
        ...p,
        returnAllowancePercent: supplierAllowances[p.supplierId] || 5,
        minimumCommitment: null,
      }));

      // 9. Run prediction service
      const attendance = parseInt(event.dailyAttendance ?? '500', 10) || 500;
      const eventDays  = calcEventDays(event.startDate, event.endDate);
      const rawPredictions = generatePurchasingPrediction(
        { attendance, eventDays, eventType: event.eventType, pricePositioning: event.pricePositioning },
        productsForPrediction,
        [],
        buf,
      );

      // 10. Apply obligation minimums — proportionally scale up if total < minimum (FIX 3)
      Object.entries(obligationMins).forEach(([supplierName, minQty]) => {
        const group = rawPredictions.filter(r => r.supplierName === supplierName);
        if (!group.length) return;
        const groupTotal = group.reduce((s, r) => s + r.predictedQty, 0);
        group.forEach(r => { r.obligationMin = minQty; });
        if (groupTotal < minQty) {
          const factor = minQty / groupTotal;
          group.forEach(r => {
            r.predictedQty    = Math.ceil(r.predictedQty * factor);
            r.bufferedQty     = r.predictedQty;
            r.safeOrderQty    = r.predictedQty;
            r.estimatedCost   = r.unitCost != null ? r.unitCost * r.predictedQty : null;
            r.obligationAdjusted = true;
            r.notes.push(`⚠️ Scaled up to meet supplier obligation minimum of ${minQty} units.`);
          });
        }
      });

      // 11. Attach rider + activation stock on top of predicted qty (FIX 4)
      const enriched = rawPredictions.map(r => {
        const riderQty      = riderStock[r.productId] || 0;
        const activationQty = activationStock[r.productId] || 0;
        const totalQty      = r.predictedQty + riderQty + activationQty;
        const notes         = [...r.notes];
        if (riderQty > 0)      notes.push(`+ ${riderQty} units for rider allocations.`);
        if (activationQty > 0) notes.push(`+ ${activationQty} units for activations.`);
        return {
          ...r,
          notes,
          riderQty,
          activationQty,
          totalQty,
          estimatedCost: r.unitCost != null ? r.unitCost * totalQty : null,
        };
      });

      setResults(enriched);
    } catch (e) {
      console.error('[PurchasingPrediction]', e?.message);
      setLoadError('Could not load prediction data. Please check your connection and try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // ── Inline edit handlers ──────────────────────────────────────────────────

  function handleQtyChange(productId, qty) {
    setResults(prev => {
      const updated = prev.map(r =>
        r.productId === productId
          ? { ...r, totalQty: qty, estimatedCost: r.unitCost != null ? r.unitCost * qty : null }
          : r
      );
      scheduleSave(updated, null);
      return updated;
    });
  }

  function handleSellPriceChange(productId, text) {
    const newPrices = { ...sellingPrices, [productId]: text };
    setSellingPrices(newPrices);
    scheduleSave(null, newPrices);
  }

  // ── Snapshot auto-save (FIX 9) ────────────────────────────────────────────

  function scheduleSave(updatedResults, updatedPrices) {
    if (snapshotTimer.current) clearTimeout(snapshotTimer.current);
    snapshotTimer.current = setTimeout(() => {
      const snap = updatedResults || results;
      const prices = updatedPrices || sellingPrices;
      saveSnapshot(snap, prices);
    }, 2000);
  }

  async function saveSnapshot(snap, prices) {
    if (!venueId || !snap.length) return;
    try {
      await setDoc(doc(db, 'venues', venueId, 'event', 'predictionSnapshot'), {
        results: snap.map(r => ({
          productId: r.productId, productName: r.productName,
          supplierId: r.supplierId, supplierName: r.supplierName,
          predictedQty: r.predictedQty, bufferedQty: r.bufferedQty,
          totalQty: r.totalQty, riderQty: r.riderQty, activationQty: r.activationQty,
          unitCost: r.unitCost, estimatedCost: r.estimatedCost,
          confidence: r.confidence, basis: r.basis, notes: r.notes,
          minimumCommitment: r.minimumCommitment ?? null,
          returnAllowancePercent: r.returnAllowancePercent,
          maxReturnable: r.maxReturnable, targetSellQty: r.targetSellQty,
          safeOrderQty: r.safeOrderQty,
          obligationAdjusted: r.obligationAdjusted || false,
          obligationMin: r.obligationMin ?? null,
        })),
        sellingPrices: prices || {},
        bufferUsed: bufferPercent,
        savedAt: serverTimestamp(),
        attendanceUsed: eventData?.dailyAttendance || null,
        totalCost: snap.reduce((s, r) => s + (r.estimatedCost || 0), 0),
      }, { merge: true });
    } catch {}
  }

  // ── Buffer stepper (FIX 7) ────────────────────────────────────────────────

  function adjustBuffer(delta) {
    const newBuf = Math.max(5, Math.min(30, bufferPercent + delta));
    setBufferPercent(newBuf);
    runFullLoad(newBuf);
  }

  // ── AI refinement helpers ─────────────────────────────────────────────────

  function getCategoryTotal(category, allResults) {
    return allResults
      .filter(r => (r.category || guessCategory(r.productName)) === category)
      .reduce((s, r) => s + r.predictedQty, 0);
  }

  function getAiQtyForProduct(result, adj, allResults) {
    if (!adj) return null;
    const cat = result.category || guessCategory(result.productName);
    const catTotal = getCategoryTotal(cat, allResults);
    const base = Math.ceil(catTotal * adj.adjustedShare);
    return base + (result.riderQty || 0) + (result.activationQty || 0);
  }

  async function refineWithAI() {
    if (!venueId || results.length === 0 || !eventData) return;
    setRefining(true);
    setRefinementError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`${apiBase()}/refine-prediction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ venueId, mathResults: results, eventDetails: eventData }),
      });
      const data = await response.json();
      if (data.ok && data.refinement) {
        const refinement: AiRefinement = data.refinement;
        setAiRefinement(refinement);
        // Default all products to use AI suggestion
        const defaults = {};
        refinement.adjustments.forEach(a => { defaults[a.productName] = true; });
        setUseAiSuggestion(defaults);
        // Apply AI quantities immediately
        refinement.adjustments.forEach(a => {
          const result = results.find(r => r.productName === a.productName);
          if (result) {
            const aiQty = getAiQtyForProduct(result, a, results);
            if (aiQty != null && aiQty > 0) handleQtyChange(result.productId, aiQty);
          }
        });
      } else {
        const msg = data.message || data.error || 'AI refinement failed. Use the math baseline instead.';
        setRefinementError(msg);
        showError(msg);
      }
    } catch (e) {
      const msg = 'Could not reach AI service. Use manual adjustments instead.';
      setRefinementError(msg);
      showError(msg);
    } finally {
      setRefining(false);
    }
  }

  function clearAiRefinement() {
    // Reset all products to their math baseline (predictedQty + riders + activations)
    results.forEach(r => {
      const mathQty = r.predictedQty + (r.riderQty || 0) + (r.activationQty || 0);
      handleQtyChange(r.productId, mathQty);
    });
    setAiRefinement(null);
    setUseAiSuggestion({});
    setRefinementError(null);
  }

  function toggleAiForProduct(productName) {
    const result = results.find(r => r.productName === productName);
    if (!result) return;
    const adj = aiRefinement?.adjustments?.find(a => a.productName === productName);
    const currentlyUsingAI = useAiSuggestion[productName] ?? true;
    const newUseAI = !currentlyUsingAI;
    setUseAiSuggestion(prev => ({ ...prev, [productName]: newUseAI }));
    if (newUseAI && adj) {
      const aiQty = getAiQtyForProduct(result, adj, results);
      if (aiQty != null && aiQty > 0) handleQtyChange(result.productId, aiQty);
    } else {
      const mathQty = result.predictedQty + (result.riderQty || 0) + (result.activationQty || 0);
      handleQtyChange(result.productId, mathQty);
    }
  }

  // ── Generate orders (FIX 11 — grouped by supplierId) ─────────────────────

  function confirmGenerateOrders() {
    const supplierCount = new Set(results.map(r => r.supplierId || 'unknown')).size;
    const totalUnits = results.reduce((s, r) => s + (r.totalQty ?? r.predictedQty ?? 0), 0);
    confirm({
      title: 'Generate draft orders?',
      message: `This will create draft orders for ${supplierCount} supplier${supplierCount !== 1 ? 's' : ''}.\n\n` +
        `Total: ~${totalUnits.toLocaleString()} units\n` +
        `Est. cost: ${formatCurrency(totalCost)}\n\n` +
        `Orders are saved as drafts — you can review and edit before submitting to suppliers.`,
      confirmLabel: 'Generate orders',
      onConfirm: () => generateOrders(),
    });
  }

  async function generateOrders() {
    if (!venueId || results.length === 0) return;
    setGenerating(true);
    try {
      const bySupplier = {};
      for (const r of results) {
        const key = r.supplierId || 'unknown';
        if (!bySupplier[key]) bySupplier[key] = [];
        bySupplier[key].push(r);
      }
      const uid  = auth.currentUser?.uid ?? 'unknown';
      const name = auth.currentUser?.displayName ?? 'Unknown';

      for (const [supplierId, items] of Object.entries(bySupplier)) {
        const orderId = `pred_${supplierId}_${Date.now()}`;
        await setDoc(doc(db, 'venues', venueId, 'orders', orderId), {
          supplierId,
          supplierName: items[0]?.supplierName ?? supplierId,
          status: 'draft',
          source: 'festival_prediction',
          createdBy: uid,
          createdByName: name,
          createdAt: serverTimestamp(),
          products: items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            quantity: i.totalQty ?? i.predictedQty,
            unitCost: i.unitCost,
            riderQty: i.riderQty || 0,
            activationQty: i.activationQty || 0,
          })),
        });
      }
      showSuccess(`✓ ${Object.keys(bySupplier).length} draft order${Object.keys(bySupplier).length !== 1 ? 's' : ''} created. Review them in Orders before sending.`);
    } catch (e) {
      showError(e?.message || 'Could not generate orders.');
    } finally {
      setGenerating(false);
    }
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────

  if (!FESTIVAL_BETA) {
    return (
      <View style={R.comingSoon}>
        {modal}
        <Text style={R.csEmoji}>🎪</Text>
        <Text style={R.csTitle}>Festival mode</Text>
        <Text style={R.csBody}>We're building something great for festival and event operators.{'\n'}Coming soon — we'll let you know when it's live.</Text>
        <Text style={R.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={R.comingSoon}>
        {modal}
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const totalCost    = results.reduce((s, r) => s + (r.estimatedCost ?? 0), 0);
  const noCostCount  = results.filter(r => r.unitCost == null).length;
  const supplierCount = new Set(results.map(r => r.supplierId)).size;
  const highConf     = results.filter(r => r.confidence === 'HIGH').length;
  const confBasis    = results.length === 0 ? '—'
    : highConf > results.length / 2 ? 'Mostly prior year data' : 'Mostly benchmarks';
  const budget       = eventData?.totalBudget ? Number(eventData.totalBudget) : null;
  const overBudget   = budget != null && totalCost > budget;
  const totalRevenue = results.reduce((s, r) => {
    const sp = parseFloat(sellingPrices[r.productId]);
    const qty = r.totalQty ?? r.predictedQty ?? 0;
    return s + (sp > 0 && qty > 0 ? sp * qty : 0);
  }, 0);
  const hasSellPrices = totalRevenue > 0;
  const estGP = hasSellPrices && totalCost > 0
    ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
    : null;
  const eventDays = calcEventDays(eventData?.startDate, eventData?.endDate);

  // Group by supplierId for display — consistent with generateOrders (FIX 11)
  const bySupplier = {};
  for (const r of results) {
    const key = r.supplierId || 'unknown';
    if (!bySupplier[key]) bySupplier[key] = [];
    bySupplier[key].push(r);
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={R.scroll} keyboardShouldPersistTaps="handled">

        {/* ── Event header (FIX 7) ── */}
        {eventData?.eventName ? (
          <View style={R.eventHeader}>
            <Text style={R.eventName}>{eventData.eventName}</Text>
            {eventData.startDate && eventData.endDate && (
              <Text style={R.eventDates}>
                {formatShortDate(eventData.startDate)} — {formatShortDate(eventData.endDate)}
                {' · '}{eventDays} day{eventDays !== 1 ? 's' : ''}
              </Text>
            )}
            {!!eventData.dailyAttendance && (
              <Text style={R.eventAttend}>
                {Number(eventData.dailyAttendance).toLocaleString()} expected per day
              </Text>
            )}
            <Text style={R.eventBasis}>Prediction basis: {confBasis}</Text>
          </View>
        ) : null}

        {/* ── Summary card (FIX 5B, 6, 7B, 10) ── */}
        <View style={R.summaryCard}>

          {/* Buffer stepper (FIX 7B) */}
          <View style={R.bufferRow}>
            <Text style={R.bufferLabel}>Safety buffer:</Text>
            <TouchableOpacity style={R.stepperSmall} onPress={() => adjustBuffer(-5)}>
              <Text style={R.stepperSmallText}>−</Text>
            </TouchableOpacity>
            <Text style={R.bufferVal}>{bufferPercent}%</Text>
            <TouchableOpacity style={R.stepperSmall} onPress={() => adjustBuffer(5)}>
              <Text style={R.stepperSmallText}>+</Text>
            </TouchableOpacity>
            <Text style={R.bufferHint}>  5–30%</Text>
          </View>

          {/* Stats */}
          <View style={R.summaryRow}>
            <View style={R.summaryItem}>
              <Text style={R.summaryValue}>{results.length}</Text>
              <Text style={R.summaryLabel}>Products</Text>
            </View>
            <View style={R.summaryItem}>
              <Text style={R.summaryValue}>{supplierCount}</Text>
              <Text style={R.summaryLabel}>Suppliers</Text>
            </View>
            <View style={R.summaryItem}>
              <Text style={R.summaryValue}>{formatCurrency(totalCost)}</Text>
              <Text style={R.summaryLabel}>Est. cost</Text>
            </View>
          </View>

          {/* Budget check (FIX 5B) */}
          {budget != null && (
            <View style={R.budgetRow}>
              <Text style={R.budgetText}>Budget: {formatCurrency(budget)}</Text>
              {overBudget
                ? <Text style={R.budgetOver}>⚠️ over by {formatCurrency(totalCost - budget)}</Text>
                : <Text style={R.budgetUnder}>✓ under by {formatCurrency(budget - totalCost)}</Text>}
            </View>
          )}

          {/* GP summary (FIX 6) */}
          {hasSellPrices && (
            <View style={R.gpSummaryRow}>
              <Text style={R.gpSummaryText}>Est. revenue: {formatCurrency(totalRevenue)}</Text>
              {estGP != null && (
                <Text style={[R.gpSummaryText, {
                  color: estGP >= 60 ? c.positiveStrong : estGP >= 40 ? c.stellarAmber : c.negativeStrong,
                }]}>
                  Est. GP: {estGP}%
                </Text>
              )}
            </View>
          )}

          {/* No cost warning (FIX 10) */}
          {noCostCount > 0 && (
            <TouchableOpacity
              style={R.noCostCard}
              onPress={() => nav.navigate('Products')}
            >
              <Text style={R.noCostCardText}>
                ⚠ {noCostCount} product{noCostCount !== 1 ? 's have' : ' has'} no cost price — total understated
              </Text>
              <Text style={R.noCostLink}>Add cost prices →</Text>
            </TouchableOpacity>
          )}

          <Text style={R.confBasis}>{confBasis}</Text>

          {/* AI refinement controls */}
          {!aiRefinement && !refining && results.length > 0 && (
            <TouchableOpacity
              style={R.refineBtn}
              onPress={refineWithAI}
              disabled={refining}
            >
              <Text style={R.refineBtnText}>✦ Refine with AI</Text>
            </TouchableOpacity>
          )}
          {refining && (
            <View style={R.refineBtn}>
              <ActivityIndicator color={c.surface} size="small" />
              <Text style={[R.refineBtnText, { marginLeft: 8 }]}>Refining…</Text>
            </View>
          )}
          {aiRefinement && (
            <View style={R.refinedBadge}>
              <Text style={R.refinedBadgeTitle}>
                ✦ AI refined{aiRefinement.historyUsed ? ' · with history' : ' · no history'}
              </Text>
              <Text style={R.refinedNote}>{aiRefinement.adjustmentNote}</Text>
              <TouchableOpacity onPress={clearAiRefinement}>
                <Text style={R.clearRefinement}>Clear AI refinement →</Text>
              </TouchableOpacity>
            </View>
          )}
          {refinementError && (
            <Text style={R.refinementError}>⚠️ {refinementError}</Text>
          )}
        </View>

        {/* ── Products grouped by supplierId (FIX 11) ── */}
        {Object.entries(bySupplier).map(([supplierId, items], supplierIndex) => {
          const supplierTotal = items.reduce((s, r) => s + (r.estimatedCost ?? 0), 0);
          const supplierName  = items[0]?.supplierName || supplierId;
          const oblMin        = items[0]?.obligationMin;
          const supplierTotalQty = items.reduce((s, r) => s + (r.totalQty ?? r.predictedQty ?? 0), 0);

          const supplierCard = (
            <View>
              <View style={R.supplierHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={R.supplierName}>{supplierName}</Text>
                  {oblMin != null && (
                    <Text style={R.oblNote}>
                      Obligation: {oblMin.toLocaleString()} units min
                      {supplierTotalQty >= oblMin ? ' ✓' : ' ⚠ at risk'}
                    </Text>
                  )}
                </View>
                {supplierTotal > 0 && (
                  <Text style={R.supplierTotal}>{formatCurrency(supplierTotal)}</Text>
                )}
              </View>
              {items.map(r => {
                const adj = aiRefinement?.adjustments?.find(a => a.productName === r.productName);
                const mathQtyDisplay = adj
                  ? r.predictedQty + (r.riderQty || 0) + (r.activationQty || 0)
                  : null;
                const aiQtyDisplay = adj
                  ? getAiQtyForProduct(r, adj, results)
                  : null;
                return (
                  <ProductRow
                    key={r.productId}
                    result={r}
                    sellingPrice={sellingPrices[r.productId] || ''}
                    onQtyChange={handleQtyChange}
                    onSellPriceChange={handleSellPriceChange}
                    aiAdjustment={adj ?? null}
                    mathQtyDisplay={mathQtyDisplay}
                    aiQtyDisplay={aiQtyDisplay}
                    useAi={useAiSuggestion[r.productName] ?? true}
                    onToggleAi={() => toggleAiForProduct(r.productName)}
                    colours={c}
                    R={R}
                  />
                );
              })}
            </View>
          );

          const isBlurred = !activated && supplierIndex > 0;

          if (isBlurred) {
            return (
              <PaywallBlurOverlay
                key={supplierId}
                onActivate={() => nav.navigate('FestivalPaywall', { venueName: eventData?.eventName })}
                message="Activate to see full order"
              >
                {supplierCard}
              </PaywallBlurOverlay>
            );
          }

          return <View key={supplierId}>{supplierCard}</View>;
        })}

        {loadError && (
          <View style={{ backgroundColor: c.negativeSoft, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.negativeStrong }}>
            <Text style={{ color: c.error, fontWeight: '700', marginBottom: 8 }}>⚠️ {loadError}</Text>
            <TouchableOpacity
              onPress={() => runFullLoad(null)}
              style={{ backgroundColor: c.error, borderRadius: 8, paddingVertical: 8, alignItems: 'center' }}
            >
              <Text style={{ color: c.surface, fontWeight: '700' }}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {results.length === 0 && !loadError && (
          <View style={R.emptyCard}>
            <Text style={R.emptyText}>No products found.</Text>
            <Text style={{ color: c.slateMid, fontSize: 13, textAlign: 'center', marginTop: 6 }}>
              Add products with a supplier assigned in the Products screen to see predictions.
            </Text>
            <TouchableOpacity
              style={{ marginTop: 14, borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 20 }}
              onPress={() => nav.navigate('Products')}
            >
              <Text style={{ color: c.deepBlue, fontWeight: '700', fontSize: 13 }}>Go to Products →</Text>
            </TouchableOpacity>
          </View>
        )}

        {results.length > 0 && (
          <TouchableOpacity
            style={[R.generateBtn, generating && R.generateBtnDisabled]}
            disabled={generating}
            onPress={confirmGenerateOrders}
          >
            {generating
              ? <ActivityIndicator color={c.surface} size="small" />
              : <Text style={R.generateBtnText}>Generate draft orders</Text>}
          </TouchableOpacity>
        )}

      </ScrollView>

      {!activated && (
        <View style={[R.paywallCTA, {
          backgroundColor: c.surface || '#ffffff',
          borderTopWidth: 1,
          borderTopColor: c.border || '#e5e7eb'
        }]}>
          <Text style={[R.paywallCTAText, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
            🔒 Showing 1 of {Object.keys(bySupplier).length} suppliers
          </Text>
          <TouchableOpacity
            style={[R.paywallCTABtn, { backgroundColor: c.deepBlue || '#1b4f72' }]}
            onPress={() => nav.navigate('FestivalPaywall', { venueName: eventData?.eventName })}
          >
            <Text style={[R.paywallCTABtnText, { fontFamily: theme.fontBodySemiBold }]}>
              Activate for $349 →
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: any) {
  return StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center', lineHeight: 22 },

  scroll: { padding: 16, paddingBottom: 60 },

  eventHeader: { backgroundColor: c.surface, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: c.border },
  eventName:   { fontSize: 18, fontWeight: '800', color: c.navy, marginBottom: 3 },
  eventDates:  { fontSize: 13, color: c.text, marginBottom: 2 },
  eventAttend: { fontSize: 13, color: c.text, marginBottom: 4 },
  eventBasis:  { fontSize: 12, color: c.slateMid },

  summaryCard:  { backgroundColor: c.deepBlue, borderRadius: 14, padding: 16, marginBottom: 16 },
  bufferRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  bufferLabel:  { color: c.surface + 'B3', fontSize: 13, marginRight: 8 },
  bufferVal:    { color: c.surface, fontWeight: '800', fontSize: 16, minWidth: 36, textAlign: 'center' },
  bufferHint:   { color: c.surface + 'B3', fontSize: 11, marginLeft: 4 },
  stepperSmall: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 6, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  stepperSmallText: { color: c.surface, fontSize: 16, fontWeight: '700' },

  summaryRow:   { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  summaryItem:  { alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '800', color: c.surface },
  summaryLabel: { fontSize: 11, color: c.surface + 'B3', marginTop: 2 },
  confBasis:    { fontSize: 11, color: c.surface + 'B3', textAlign: 'center', marginTop: 4 },

  budgetRow:    { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: 10, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetText:   { color: c.surface + 'CC', fontSize: 13 },
  budgetOver:   { color: c.negativeStrong, fontWeight: '700', fontSize: 13 },
  budgetUnder:  { color: c.positiveStrong, fontWeight: '700', fontSize: 13 },

  gpSummaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8 },
  gpSummaryText:{ color: c.surface + 'CC', fontSize: 12, fontWeight: '600' },

  noCostCard:     { backgroundColor: 'rgba(251,191,36,0.15)', borderRadius: 8, padding: 10, marginTop: 6 },
  noCostCardText: { color: c.stellarAmber, fontSize: 12, fontWeight: '600' },
  noCostLink:     { color: c.surface + 'B3', fontSize: 12, marginTop: 2 },

  supplierHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 8, marginTop: 12 },
  supplierName:   { fontSize: 14, fontWeight: '800', color: c.text },
  oblNote:        { fontSize: 11, color: c.stellarAmber, marginTop: 2 },
  supplierTotal:  { fontSize: 13, fontWeight: '700', color: c.deepBlue },

  prodRow:   { backgroundColor: c.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: c.border },
  prodTop:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 },
  prodName:  { fontSize: 14, fontWeight: '700', color: c.navy, flex: 1, marginRight: 8 },
  confBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, flexShrink: 0 },
  confText:  { fontSize: 10, fontWeight: '800' },
  basisText: { fontSize: 11, color: c.slateMid, marginBottom: 8 },

  breakdownBox: { backgroundColor: c.oat, borderRadius: 8, padding: 10, marginBottom: 10 },
  bkRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  bkLabel:      { fontSize: 13, color: c.slateMid },
  bkQty:        { fontSize: 13, color: c.text, fontWeight: '600' },
  bkDivider:    { height: 1, backgroundColor: c.border, marginVertical: 6 },
  stepperRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBtn:   { width: 30, height: 30, borderRadius: 15, backgroundColor: c.border, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 18, fontWeight: '700', color: c.text },
  qtyInput:     { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, fontSize: 15, fontWeight: '700', color: c.navy, width: 70, textAlign: 'center', backgroundColor: c.surface },
  returnNote:   { fontSize: 11, color: c.slateMid, marginTop: 4 },

  pricingBox:  { backgroundColor: c.primaryLight, borderRadius: 8, padding: 10, marginBottom: 8 },
  pricingRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' },
  pricingLbl:  { fontSize: 12, color: c.slateMid, width: 44 },
  pricingVal:  { fontSize: 12, color: c.text, fontWeight: '600', flex: 1 },
  sellInput:   { borderWidth: 1, borderColor: c.deepBlue, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, fontSize: 13, fontWeight: '600', color: c.deepBlue, width: 64, textAlign: 'center', backgroundColor: c.surface },
  gpText:      { fontSize: 13, fontWeight: '800' },
  noCostWarn:  { fontSize: 11, color: c.stellarAmber, marginBottom: 4 },

  commitWarn: { fontSize: 11, color: c.error, marginTop: 4, fontWeight: '600' },

  notesToggle:    { marginTop: 6 },
  notesToggleText:{ fontSize: 11, color: c.deepBlue, fontWeight: '600' },
  noteText:       { fontSize: 12, color: c.slateMid, lineHeight: 18, marginTop: 3 },

  generateBtn:         { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  generateBtnDisabled: { opacity: 0.5 },
  generateBtnText:     { color: c.surface, fontWeight: '700', fontSize: 16 },

  emptyCard: { backgroundColor: c.surface, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  emptyText: { fontSize: 15, color: c.slateMid, textAlign: 'center', fontWeight: '600' },

  // AI refinement — summary card
  refineBtn:         { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  refineBtnText:     { color: c.surface, fontWeight: '700', fontSize: 14 },
  refinedBadge:      { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 8, padding: 10, marginTop: 10 },
  refinedBadgeTitle: { color: c.surface, fontWeight: '800', fontSize: 13, marginBottom: 3 },
  refinedNote:       { color: c.surface + 'CC', fontSize: 12, marginBottom: 6 },
  clearRefinement:   { color: c.surface + 'B3', fontSize: 12, fontWeight: '600' },
  refinementError:   { color: c.negativeStrong, fontSize: 12, marginTop: 6, textAlign: 'center' },

  // AI refinement — product row
  aiCompareBox:     { backgroundColor: c.primaryLight, borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: c.deepBlue },
  aiCompareRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  aiCompareLabel:   { fontSize: 13, color: c.slateMid },
  aiActiveLabel:    { color: c.deepBlue, fontWeight: '800' },
  aiArrow:          { fontSize: 12, color: c.slateMid },
  aiReasoning:      { fontSize: 12, color: c.text, fontStyle: 'italic', marginBottom: 6 },
  aiConfidenceRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aiConfidence:     { fontSize: 11, color: c.slateMid },
  aiToggleBtn:      { backgroundColor: c.deepBlue, borderRadius: 6, paddingVertical: 4, paddingHorizontal: 10 },
  aiToggleBtnText:  { color: c.surface, fontSize: 12, fontWeight: '700' },

  // Paywall sticky CTA
  paywallCTA: { padding: 16, paddingBottom: 32 },
  paywallCTAText: { fontSize: 14, marginBottom: 10, textAlign: 'center' },
  paywallCTABtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  paywallCTABtnText: { color: '#ffffff', fontSize: 15 },
  });
}
