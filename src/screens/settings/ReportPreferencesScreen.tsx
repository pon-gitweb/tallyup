// @ts-nocheck
/**
 * ReportPreferencesScreen
 * Settings → Report Preferences
 * Simple toggle-and-pick UI for customising report output.
 * Changes apply to all future exports and prints.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import {
  ReportPreferences, DEFAULT_REPORT_PREFS,
  loadReportPreferences, saveReportPreferences,
} from '../../services/reportPreferences/ReportPreferencesService';
import { withErrorBoundary } from '../../components/ErrorCatcher';

type ToggleRowProps = {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  C: any;
};

function ToggleRow({ label, description, value, onToggle, C }: ToggleRowProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ fontWeight: '700', color: C.text }}>{label}</Text>
        {description && <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>{description}</Text>}
      </View>
      <Switch value={value} onValueChange={onToggle} trackColor={{ true: C.accent }} thumbColor="#fff" />
    </View>
  );
}

type PickerRowProps = {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onPick: (v: string) => void;
  C: any;
};

function PickerRow({ label, options, value, onPick, C }: PickerRowProps) {
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={{ fontWeight: '700', color: C.text, marginBottom: 8 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map(opt => (
          <TouchableOpacity key={opt.value} onPress={() => onPick(opt.value)}
            style={{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
              backgroundColor: value === opt.value ? C.primary : '#F1F5F9',
              borderWidth: 1, borderColor: value === opt.value ? C.primary : C.border,
            }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: value === opt.value ? '#fff' : C.textSecondary }}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function SectionHeader({ title, C }: { title: string; C: any }) {
  return (
    <View style={{ backgroundColor: C.primaryLight, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginTop: 8 }}>
      <Text style={{ fontWeight: '900', color: C.accent, fontSize: 13 }}>{title}</Text>
    </View>
  );
}

function ReportPreferencesScreen() {
  const venueId = useVenueId();
  const C = useColours();
  const [prefs, setPrefs] = useState<ReportPreferences>(DEFAULT_REPORT_PREFS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (venueId) loadReportPreferences(venueId).then(setPrefs);
  }, [venueId]);

  const updateStocktake = useCallback((patch: Partial<typeof prefs.stocktake>) => {
    setPrefs(p => ({ ...p, stocktake: { ...p.stocktake, ...patch } }));
  }, []);

  const updateOrder = useCallback((patch: Partial<typeof prefs.order>) => {
    setPrefs(p => ({ ...p, order: { ...p.order, ...patch } }));
  }, []);

  const onSave = useCallback(async () => {
    if (!venueId) return;
    setSaving(true);
    await saveReportPreferences(venueId, prefs);
    setSaving(false);
    Alert.alert('Saved', 'Report preferences updated.');
  }, [venueId, prefs]);

  const onReset = useCallback(async () => {
    Alert.alert('Reset preferences', 'Restore default report settings?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', onPress: async () => {
        setPrefs(DEFAULT_REPORT_PREFS);
        if (venueId) await saveReportPreferences(venueId, DEFAULT_REPORT_PREFS);
      }},
    ]);
  }, [venueId]);

  const S = prefs.stocktake;
  const O = prefs.order;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.background }} contentContainerStyle={{ padding: 16, gap: 12 }}>

      <View>
        <Text style={{ fontSize: 22, fontWeight: '900', color: C.text }}>Report Preferences</Text>
        <Text style={{ color: C.textSecondary, marginTop: 4, fontSize: 14 }}>
          Choose what appears on your stocktake and order reports.
        </Text>
      </View>

      {/* Stocktake report */}
      <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border }}>
        <SectionHeader title="STOCKTAKE REPORTS" C={C} />

        <ToggleRow label="Show zero variance items" description="Items where counted = expected" value={S.showZeroVariance} onToggle={v => updateStocktake({ showZeroVariance: v })} C={C} />
        <ToggleRow label="Show expected quantity" description="Expected vs actual count" value={S.showExpectedQty} onToggle={v => updateStocktake({ showExpectedQty: v })} C={C} />
        <ToggleRow label="Show cost per item" value={S.showCostValue} onToggle={v => updateStocktake({ showCostValue: v })} C={C} />
        <ToggleRow label="Show total stock value" value={S.showTotalValue} onToggle={v => updateStocktake({ showTotalValue: v })} C={C} />
        <ToggleRow label="Show supplier" value={S.showSupplier} onToggle={v => updateStocktake({ showSupplier: v })} C={C} />
        <ToggleRow label="Show category / department" value={S.showCategory} onToggle={v => updateStocktake({ showCategory: v })} C={C} />
        <ToggleRow label="Show venue logo" value={S.showLogo} onToggle={v => updateStocktake({ showLogo: v })} C={C} />
        <ToggleRow label="Show date and time" value={S.showDate} onToggle={v => updateStocktake({ showDate: v })} C={C} />
        <ToggleRow label="Include signature line" description="For manager sign-off" value={S.showSignatureLine} onToggle={v => updateStocktake({ showSignatureLine: v })} C={C} />

        <PickerRow label="Variance format" value={S.varianceFormat} onPick={v => updateStocktake({ varianceFormat: v as any })} C={C}
          options={[
            { value: 'units', label: 'Units' },
            { value: 'percentage', label: '%' },
            { value: 'dollars', label: '$' },
            { value: 'all', label: 'All' },
          ]} />

        <PickerRow label="Group items by" value={S.groupBy} onPick={v => updateStocktake({ groupBy: v as any })} C={C}
          options={[
            { value: 'area', label: 'Area' },
            { value: 'supplier', label: 'Supplier' },
            { value: 'category', label: 'Category' },
            { value: 'none', label: 'None' },
          ]} />

        <PickerRow label="Sort items by" value={S.sortBy} onPick={v => updateStocktake({ sortBy: v as any })} C={C}
          options={[
            { value: 'name', label: 'Name' },
            { value: 'variance', label: 'Variance' },
            { value: 'value', label: 'Value' },
          ]} />
      </View>

      {/* Order report */}
      <View style={{ backgroundColor: C.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border }}>
        <SectionHeader title="ORDER REPORTS" C={C} />
        <ToggleRow label="Show unit cost" value={O.showUnitCost} onToggle={v => updateOrder({ showUnitCost: v })} C={C} />
        <ToggleRow label="Show line total" value={O.showLineTotal} onToggle={v => updateOrder({ showLineTotal: v })} C={C} />
        <ToggleRow label="Show order total" value={O.showOrderTotal} onToggle={v => updateOrder({ showOrderTotal: v })} C={C} />
        <ToggleRow label="Show supplier details" value={O.showSupplierDetails} onToggle={v => updateOrder({ showSupplierDetails: v })} C={C} />
        <ToggleRow label="Show delivery notes" value={O.showDeliveryNotes} onToggle={v => updateOrder({ showDeliveryNotes: v })} C={C} />
        <ToggleRow label="Show venue logo" value={O.showLogo} onToggle={v => updateOrder({ showLogo: v })} C={C} />
        <ToggleRow label="Show date" value={O.showDate} onToggle={v => updateOrder({ showDate: v })} C={C} />
        <ToggleRow label="Include signature line" value={O.showSignatureLine} onToggle={v => updateOrder({ showSignatureLine: v })} C={C} />
      </View>

      {/* Save */}
      <TouchableOpacity onPress={onSave} disabled={saving}
        style={{ backgroundColor: C.primary, borderRadius: 12, padding: 16, alignItems: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
          {saving ? 'Saving...' : 'Save preferences'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onReset} style={{ alignItems: 'center', padding: 8 }}>
        <Text style={{ color: C.textSecondary, fontSize: 13 }}>Reset to defaults</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(ReportPreferencesScreen, 'ReportPreferences');
