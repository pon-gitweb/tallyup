// @ts-nocheck
import React from 'react';
import {
  ScrollView, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

export type InvoiceSummaryParams = {
  supplierName: string | null;
  isNewSupplier?: boolean;
  supplierAccountNumber?: string | null;
  productCount: number;
  newProductCount?: number;
  existingProductCount?: number;
  matchedOrderNumber?: string | null;
  priceChanges?: Array<{ name: string; oldPrice: number; newPrice: number }>;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  ageCategory?: 'current' | 'late' | 'historical' | 'old' | 'very_old' | 'unknown';
  wrongVenueName?: string | null;
  // callbacks via navigation
  onReviewProducts?: string;  // screen name to navigate to
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
  } = params;

  const ageInfo = ageCategory ? AGE_MSGS[ageCategory] : null;
  const hasPriceChanges = priceChanges.length > 0;
  const hasWrongVenue = !!wrongVenueName;

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

        {hasPriceChanges && priceChanges.slice(0, 3).map((pc, i) => {
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
