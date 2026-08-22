// @ts-nocheck
import React, { useState } from 'react';
import {
  ScrollView, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import { useColours } from '../../context/ThemeContext';
import { useVenueId } from '../../context/VenueProvider';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useToast } from '../../components/common/Toast';

export type InvoiceSummaryParams = {
  supplierName: string | null;
  isNewSupplier?: boolean;
  supplierAccountNumber?: string | null;
  productCount: number;
  newProductCount?: number;
  existingProductCount?: number;
  matchedOrderNumber?: string | null;
  priceChanges?: Array<{
    name: string;
    productId?: string;
    oldPrice: number;
    newPrice: number;
    changePercent?: number;
    direction?: string;
    qty?: number;
    caseSize?: number | null;
    possibleCaseMismatch?: boolean;
    caseMismatchGuess?: number | null;
    correctedUnitPrice?: number | null;
    correctedChangePercent?: number | null;
    reasoning?: {
      isolatedVsTrend: 'isolated' | 'trending';
      similarChangesOnInvoice: number;
      supplierMismatch: boolean;
      preferredSupplierName: string | null;
      matchConfidence: 'high' | 'moderate';
      matchScore: number;
    };
  }>;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  ageCategory?: 'current' | 'late' | 'historical' | 'old' | 'very_old' | 'unknown';
  wrongVenueName?: string | null;
  venueType?: string | null;
  supplierId?: string | null;
  invoiceDocId?: string | null;
  onReviewProducts?: string;
};

const AGE_MSGS: Record<string, { icon: string; label: string; body: string }> = {
  current:    { icon: 'ℹ', label: 'Invoice age: current',    body: 'This invoice is within 30 days — stock has been updated.' },
  late:       { icon: 'ℹ', label: 'Invoice age: late',       body: 'This invoice is 1–3 months old — stock has been updated.' },
  historical: { icon: '⚠', label: 'Invoice age: historical', body: 'This invoice is over 3 months old — catalogued for reference only, stock not updated.' },
  old:        { icon: '⚠', label: 'Invoice age: old',        body: 'This invoice is over a year old — historical pricing captured, stock not updated.' },
  very_old:   { icon: '⚠', label: 'Invoice age: very old',   body: 'This invoice is several years old — archived for reference only.' },
  unknown:    { icon: 'ℹ', label: 'Invoice age: unknown',    body: 'Invoice date could not be determined.' },
};

function SectionRow({
  icon, label, sub, isWarning, colours,
}: { icon: string; label: string; sub?: string; isWarning?: boolean; colours: any }) {
  return (
    <View style={{
      flexDirection: 'row', gap: 12, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: colours.border,
    }}>
      <Text style={{ fontSize: 16, width: 24, textAlign: 'center', color: isWarning ? '#b45309' : colours.success }}>
        {icon}
      </Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colours.navy }}>{label}</Text>
        {!!sub && <Text style={{ fontSize: 12, color: colours.textSecondary, marginTop: 2, lineHeight: 17 }}>{sub}</Text>}
      </View>
    </View>
  );
}

function InvoiceSummaryScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const colours = useColours();
  const venueId = useVenueId();
  const { showError } = useToast();
  const params: InvoiceSummaryParams = route.params || {};

  const {
    supplierName,
    isNewSupplier,
    supplierAccountNumber,
    productCount = 0,
    newProductCount,
    existingProductCount,
    matchedOrderNumber,
    priceChanges = [],
    invoiceNumber,
    invoiceDate,
    ageCategory,
    wrongVenueName,
    venueType,
    supplierId,
    invoiceDocId,
  } = params;

  const isFestival = venueType === 'festival';
  const [disputed, setDisputed] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [caseMismatchDismissed, setCaseMismatchDismissed] = useState<string[]>([]);

  const ageInfo = ageCategory ? AGE_MSGS[ageCategory] : null;
  const hasPriceChanges = priceChanges.length > 0;
  const hasWrongVenue = !!wrongVenueName;

  const totalOvercharge = isFestival
    ? priceChanges.reduce((sum, pc) => {
        const totalUnits = (pc.qty || 1) * (pc.caseSize || 1);
        const effectiveNewPrice =
          pc.possibleCaseMismatch && !caseMismatchDismissed.includes(pc.name) && pc.correctedUnitPrice != null
            ? pc.correctedUnitPrice
            : pc.newPrice;
        return sum + Math.max(0, (effectiveNewPrice - pc.oldPrice) * totalUnits);
      }, 0)
    : 0;

  async function flagDispute(pc: any) {
    if (!venueId) return;
    try {
      await addDoc(collection(db, 'venues', venueId, 'priceDisputes'), {
        productId: pc.productId || null,
        productName: pc.name,
        supplierId: supplierId || null,
        supplierName: supplierName || null,
        invoiceId: invoiceDocId || invoiceNumber || null,
        invoicePrice: pc.newPrice,
        agreedPrice: pc.oldPrice,
        difference: pc.newPrice - pc.oldPrice,
        differencePercent: pc.changePercent || 0,
        estimatedOvercharge: (pc.newPrice - pc.oldPrice) * (pc.qty || 1) * (pc.caseSize || 1),
        status: 'open',
        createdAt: serverTimestamp(),
        createdBy: getAuth().currentUser?.uid || null,
      });
      setDisputed(prev => [...prev, pc.name]);
    } catch (e: any) {
      showError('Could not flag dispute: ' + (e?.message || 'unknown error'));
    }
  }

  async function acceptPrice(pc: any) {
    if (!venueId || !pc.productId) return;
    try {
      await updateDoc(doc(db, 'venues', venueId, 'products', pc.productId), {
        costPrice: pc.newPrice,
        priceAcceptedAt: serverTimestamp(),
        priceAcceptedBy: getAuth().currentUser?.uid || null,
        priceChanged: false,
      });
      setAccepted(prev => [...prev, pc.name]);
    } catch (e: any) {
      showError('Could not accept price: ' + (e?.message || 'unknown error'));
    }
  }

  async function acceptCorrectedPrice(pc: any) {
    if (!venueId || !pc.productId) return;
    try {
      await updateDoc(doc(db, 'venues', venueId, 'products', pc.productId), {
        costPrice: pc.correctedUnitPrice,
        priceAcceptedAt: serverTimestamp(),
        priceAcceptedBy: getAuth().currentUser?.uid || null,
        priceChanged: false,
      });
      setAccepted(prev => [...prev, pc.name]);
    } catch (e: any) {
      showError('Could not accept price: ' + (e?.message || 'unknown error'));
    }
  }

  const supplierSub = [
    isNewSupplier ? 'New supplier added' : 'Existing supplier',
    supplierAccountNumber ? `Acct #${supplierAccountNumber}` : null,
  ].filter(Boolean).join(' · ');

  const productsSub = [
    existingProductCount != null ? `${existingProductCount} existing` : null,
    newProductCount != null ? `${newProductCount} new` : null,
  ].filter(Boolean).join(' · ');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colours.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      {/* Header */}
      <View style={{
        backgroundColor: colours.primary, borderRadius: 16, padding: 20, marginBottom: 20,
      }}>
        <Text style={{ fontSize: 20, fontWeight: '900', color: colours.primaryText }}>
          Invoice processed{supplierName ? ` — ${supplierName}` : ''}
        </Text>
        {(invoiceNumber || invoiceDate) && (
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 }}>
            {[invoiceNumber, invoiceDate].filter(Boolean).join(' · ')}
          </Text>
        )}
      </View>

      {/* Summary card */}
      <View style={{
        backgroundColor: colours.surface, borderRadius: 14,
        borderWidth: 1, borderColor: colours.border, marginBottom: 16, overflow: 'hidden',
      }}>
        {supplierName && (
          <SectionRow
            icon="✓"
            label={`Supplier: ${supplierName}`}
            sub={supplierSub || undefined}
            colours={colours}
          />
        )}

        {productCount > 0 && (
          <SectionRow
            icon="✓"
            label={`${productCount} product${productCount !== 1 ? 's' : ''} identified`}
            sub={productsSub || undefined}
            colours={colours}
          />
        )}

        {matchedOrderNumber ? (
          <SectionRow
            icon="✓"
            label={`Order matched: #${matchedOrderNumber}`}
            colours={colours}
          />
        ) : (
          <SectionRow
            icon="ℹ"
            label="No matching order found"
            sub="Create an order from the Orders screen to link future invoices automatically."
            colours={colours}
          />
        )}

        {hasPriceChanges && isFestival && (
          <View style={{ backgroundColor: '#FEF3C7', borderRadius: 12, padding: 14, marginVertical: 4, borderWidth: 1.5, borderColor: '#D97706' }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: '#92400E', marginBottom: 12 }}>
              ⚠️ Price discrepancy — action required
            </Text>
            {priceChanges.map((pc, i) => {
              const totalUnits = (pc.qty || 1) * (pc.caseSize || 1);
              const isDisputed = disputed.includes(pc.name);
              const isAccepted = accepted.includes(pc.name);
              const isCaseMismatch = pc.possibleCaseMismatch && !caseMismatchDismissed.includes(pc.name);
              const effectiveNewPrice = isCaseMismatch && pc.correctedUnitPrice != null ? pc.correctedUnitPrice : pc.newPrice;
              const overcharge = (effectiveNewPrice - pc.oldPrice) * totalUnits;
              const sign = (pc.newPrice > pc.oldPrice) ? '+' : '';

              // Plain-language reasoning context shown beneath normal price-change cards
              const ReasoningLines = pc.reasoning && !isCaseMismatch ? (
                <View style={{ marginTop: 6, gap: 3 }}>
                  {pc.reasoning.isolatedVsTrend === 'trending' ? (
                    <Text style={{ color: '#6B7280', fontSize: 12 }}>
                      {pc.reasoning.similarChangesOnInvoice} other item{pc.reasoning.similarChangesOnInvoice !== 1 ? 's' : ''} on this invoice also changed by a similar amount — this may be a supplier-wide change.
                    </Text>
                  ) : (
                    <Text style={{ color: '#6B7280', fontSize: 12 }}>
                      This is the only item on this invoice showing a change like this.
                    </Text>
                  )}
                  {pc.reasoning.supplierMismatch && (
                    <Text style={{ color: '#6B7280', fontSize: 12 }}>
                      {pc.reasoning.preferredSupplierName
                        ? `This product is usually supplied by ${pc.reasoning.preferredSupplierName} — this invoice is from a different supplier.`
                        : "This product's usual supplier differs from this invoice's supplier."}
                    </Text>
                  )}
                  {pc.reasoning.matchConfidence === 'moderate' && (
                    <Text style={{ color: '#6B7280', fontSize: 12 }}>
                      Product name match is approximate — review carefully.
                    </Text>
                  )}
                </View>
              ) : null;

              return (
                <View key={i} style={{ marginBottom: i < priceChanges.length - 1 ? 14 : 0, paddingBottom: i < priceChanges.length - 1 ? 14 : 0, borderBottomWidth: i < priceChanges.length - 1 ? 1 : 0, borderBottomColor: '#FDE68A' }}>
                  {isCaseMismatch ? (
                    // Case-mismatch card — calm blue styling, this is usually good news
                    <View style={{ backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, borderWidth: 1.5, borderColor: '#3B82F6' }}>
                      <Text style={{ fontWeight: '800', color: '#1E3A5F', marginBottom: 4 }}>{pc.name}</Text>
                      <Text style={{ color: '#374151', fontSize: 13 }}>
                        Invoice price: ${pc.newPrice.toFixed(2)}/unit — usual price: ${pc.oldPrice.toFixed(2)}/unit ({sign}{Math.abs(pc.changePercent || 0).toFixed(0)}%)
                      </Text>
                      <Text style={{ color: '#1D4ED8', fontSize: 13, marginTop: 6, lineHeight: 18 }}>
                        This looks like a case price{pc.caseMismatchGuess ? ` for ${pc.caseMismatchGuess} units` : ''} compared against a single unit cost. The corrected per-unit price would be ${pc.correctedUnitPrice?.toFixed(2)} — no real change.
                      </Text>
                      {!isAccepted && (
                        <View style={{ gap: 8, marginTop: 10 }}>
                          <TouchableOpacity
                            onPress={() => acceptCorrectedPrice(pc)}
                            style={{ backgroundColor: '#1D4ED8', borderRadius: 8, paddingVertical: 9, alignItems: 'center' }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Yes, that's a case price — use ${pc.correctedUnitPrice?.toFixed(2)}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => setCaseMismatchDismissed(prev => [...prev, pc.name])}
                            style={{ backgroundColor: '#E5E7EB', borderRadius: 8, paddingVertical: 9, alignItems: 'center' }}
                          >
                            <Text style={{ color: '#374151', fontWeight: '700', fontSize: 13 }}>No, treat as a real price change</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {isAccepted && <Text style={{ color: '#16A34A', fontWeight: '700', marginTop: 6, fontSize: 13 }}>✓ Corrected price accepted</Text>}
                    </View>
                  ) : (
                    // Normal price-change card (amber)
                    <>
                      <Text style={{ fontWeight: '800', color: '#0B132B', marginBottom: 4 }}>{pc.name}</Text>
                      <Text style={{ color: '#374151', fontSize: 13 }}>Invoice price: ${pc.newPrice.toFixed(2)}/unit</Text>
                      <Text style={{ color: '#374151', fontSize: 13 }}>Last agreed: ${pc.oldPrice.toFixed(2)}/unit</Text>
                      <Text style={{ color: '#92400E', fontWeight: '700', fontSize: 13 }}>
                        Difference: {sign}${Math.abs(pc.newPrice - pc.oldPrice).toFixed(2)} ({sign}{Math.abs(pc.changePercent || 0).toFixed(1)}%)
                      </Text>
                      {overcharge !== 0 && pc.qty != null && (
                        <Text style={{ color: '#92400E', fontSize: 12, marginTop: 2 }}>
                          Est. overcharge on this delivery: ${Math.abs(overcharge).toFixed(2)}
                        </Text>
                      )}
                      {ReasoningLines}
                      {!isDisputed && !isAccepted && (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                          <TouchableOpacity
                            onPress={() => flagDispute(pc)}
                            style={{ flex: 1, backgroundColor: '#DC2626', borderRadius: 8, paddingVertical: 9, alignItems: 'center' }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Flag for dispute</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => acceptPrice(pc)}
                            style={{ flex: 1, backgroundColor: '#6B7280', borderRadius: 8, paddingVertical: 9, alignItems: 'center' }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>Accept price</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {isDisputed && <Text style={{ color: '#16A34A', fontWeight: '700', marginTop: 6, fontSize: 13 }}>✓ Flagged for dispute</Text>}
                      {isAccepted && <Text style={{ color: '#6B7280', fontWeight: '700', marginTop: 6, fontSize: 13 }}>✓ Price accepted</Text>}
                    </>
                  )}
                </View>
              );
            })}
            {totalOvercharge > 0 && (
              <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#FDE68A' }}>
                <Text style={{ fontWeight: '800', color: '#92400E' }}>
                  Total potential overcharge: ${totalOvercharge.toFixed(2)}
                </Text>
              </View>
            )}
          </View>
        )}

        {hasPriceChanges && !isFestival && priceChanges.slice(0, 3).map((pc, i) => {
          const pct = pc.oldPrice > 0
            ? ((pc.newPrice - pc.oldPrice) / pc.oldPrice * 100).toFixed(0)
            : null;
          const sign = pc.newPrice > pc.oldPrice ? '+' : '';
          return (
            <SectionRow
              key={i}
              icon="⚠"
              isWarning
              label={`Price change: ${pc.name}${pct ? ` ${sign}${pct}%` : ''}`}
              sub={`$${pc.oldPrice.toFixed(2)} → $${pc.newPrice.toFixed(2)}`}
              colours={colours}
            />
          );
        })}

        {ageInfo && (
          <View style={{
            flexDirection: 'row', gap: 12, paddingVertical: 12,
          }}>
            <Text style={{ fontSize: 16, width: 24, textAlign: 'center', color: colours.textSecondary }}>
              {ageInfo.icon}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colours.navy }}>{ageInfo.label}</Text>
              <Text style={{ fontSize: 12, color: colours.textSecondary, marginTop: 2, lineHeight: 17 }}>{ageInfo.body}</Text>
            </View>
          </View>
        )}

        {hasWrongVenue && (
          <View style={{
            backgroundColor: '#FEF3C7', padding: 12, borderRadius: 10, margin: 12,
          }}>
            <Text style={{ fontWeight: '800', color: '#92400E', marginBottom: 4 }}>
              ⚠ Wrong venue?
            </Text>
            <Text style={{ fontSize: 13, color: '#92400E', lineHeight: 18 }}>
              This invoice is addressed to {wrongVenueName}. Check it belongs to this venue before accepting.
            </Text>
          </View>
        )}
      </View>

      {/* Actions */}
      <View style={{ gap: 10 }}>
        <TouchableOpacity
          onPress={() => nav.navigate('Orders')}
          style={{
            backgroundColor: colours.primary, borderRadius: 12,
            paddingVertical: 14, alignItems: 'center',
          }}
        >
          <Text style={{ color: colours.primaryText, fontWeight: '800', fontSize: 15 }}>
            View orders →
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => nav.navigate('Dashboard')}
          style={{
            backgroundColor: colours.surface, borderRadius: 12,
            paddingVertical: 14, alignItems: 'center',
            borderWidth: 1, borderColor: colours.border,
          }}
        >
          <Text style={{ color: colours.textSecondary, fontWeight: '600', fontSize: 15 }}>
            Back to dashboard
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default withErrorBoundary(InvoiceSummaryScreen, 'InvoiceSummary');
