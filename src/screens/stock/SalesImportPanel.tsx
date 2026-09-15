// @ts-nocheck
import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useToast } from '../../components/common/Toast';
import * as DocumentPicker from 'expo-document-picker';
import { useVenueId } from '../../context/VenueProvider';
import { processSalesCsv } from '../../services/sales/processSalesCsv';
import { storeSalesReport, supersedeSalesReports } from '../../services/sales/storeSalesReport';
import { checkPeriodOverlap, OverlappingReport } from '../../services/sales/checkPeriodOverlap';
import { matchAndPersist } from '../../services/sales/matchSalesToRecipes';
import SalesPeriodConfirmStep from '../../components/sales/SalesPeriodConfirmStep';
import SalesConflictStep from '../../components/sales/SalesConflictStep';

type PendingUpload = {
  report: any;
  suggestedStart: string | null;
  suggestedEnd: string | null;
  lineCount: number;
};

export default function SalesImportPanel({ onClose }:{ onClose: ()=>void }) {
  const { showError, showSuccess, showInfo, showWarning } = useToast();
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingUpload | null>(null);
  const [conflict, setConflict] = useState<{
    start: string;
    end: string;
    reports: OverlappingReport[];
  } | null>(null);

  // ── Step 1: pick + parse ──────────────────────────────────────────────────

  const pickAndProcess = useCallback(async ()=>{
    try{
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv'],
        multiple: false,
        copyToCacheDirectory: true
      });
      if (res.canceled || !res.assets?.[0]) return;

      setBusy(true);
      const a = res.assets[0];
      const isCsv =
        (a.mimeType || '').includes('csv') ||
        /\.csv$/i.test(a.name || '');

      if (!isCsv) {
        showInfo('Sales PDF imports are not enabled yet on this project. Please export a CSV from your POS instead.');
        setBusy(false);
        return;
      }

      if (!venueId) throw new Error('Not ready: no venue selected');
      if (!a.uri?.startsWith('file')) throw new Error('Expected a local file URI');

      const parsed = await processSalesCsv({
        venueId,
        fileUri: a.uri,
        filename: a.name || 'sales.csv',
      });

      const lineCount = parsed?.lines?.length ?? 0;
      if (lineCount === 0) {
        showInfo('No lines were found in this CSV.');
        setBusy(false);
        return;
      }

      // Hand off to the period-confirm step
      setPending({
        report: parsed?.report || parsed,
        suggestedStart: parsed?.period?.start ?? null,
        suggestedEnd: parsed?.period?.end ?? null,
        lineCount,
      });
      setBusy(false);
    }catch(e:any){
      showError(String(e?.message||e));
      setBusy(false);
    }
  }, [venueId]);

  // ── Step 2a: upload (shared by direct-confirm and conflict-resolve paths) ──

  const performUpload = useCallback(async (
    confirmedStart: string,
    confirmedEnd: string,
    idsToSupersede?: string[],
  ) => {
    if (!pending || !venueId) return;
    setBusy(true);
    try {
      const saved = await storeSalesReport({
        venueId,
        report: pending.report,
        source: 'csv',
        confirmedPeriod: { start: confirmedStart, end: confirmedEnd },
      });
      if (!saved?.ok) throw new Error(saved?.error || 'Could not save sales report');

      // Soft-supersede any reports the user chose to replace
      if (idsToSupersede?.length && saved.id) {
        await supersedeSalesReports(venueId, idsToSupersede, saved.id);
      }

      // Non-blocking: recipe matching
      if (pending.report?.lines?.length > 0 && saved?.id) {
        matchAndPersist(venueId, pending.report.lines, saved.id).catch(e => {
          if (__DEV__) console.log('[SalesImport] recipe match failed (non-fatal)', e?.message);
        });
      }

      showSuccess('CSV imported and stored. Analytics will use this when a POS API is not connected.');

      if (saved.zeroCycleWarning) {
        const warn = showWarning ?? showInfo;
        warn(
          `This report (${confirmedStart} – ${confirmedEnd}) doesn't line up with any completed stocktake yet — it's saved, but won't factor into comparisons until a cycle covers this period.`,
        );
      }

      setConflict(null);
      setPending(null);
      onClose();
    } catch(e: any) {
      showError(String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [pending, venueId, onClose]);

  // ── Step 2b: period confirmed — check for overlap, then upload or show conflict

  const handlePeriodConfirm = useCallback(async (confirmedStart: string, confirmedEnd: string) => {
    if (!pending || !venueId) return;
    setBusy(true);
    let overlapping: OverlappingReport[] = [];
    try {
      overlapping = await checkPeriodOverlap(venueId, confirmedStart, confirmedEnd);
    } catch (e: any) {
      showError('Could not check for existing reports: ' + String(e?.message || e));
      setBusy(false);
      return;
    }
    setBusy(false);

    if (overlapping.length > 0) {
      setConflict({ start: confirmedStart, end: confirmedEnd, reports: overlapping });
      return;
    }
    await performUpload(confirmedStart, confirmedEnd);
  }, [pending, venueId, performUpload]);

  // ── Step 2c: conflict resolved ────────────────────────────────────────────

  const handleConflictReplace = useCallback(async () => {
    if (!conflict) return;
    await performUpload(conflict.start, conflict.end, conflict.reports.map(r => r.id));
  }, [conflict, performUpload]);

  const handleConflictKeepBoth = useCallback(async () => {
    if (!conflict) return;
    await performUpload(conflict.start, conflict.end);
  }, [conflict, performUpload]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (conflict) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#fff' }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 12 }}>
          Sales Report Import (CSV)
        </Text>
        <SalesConflictStep
          newStart={conflict.start}
          newEnd={conflict.end}
          conflicts={conflict.reports}
          onReplace={handleConflictReplace}
          onKeepBoth={handleConflictKeepBoth}
          onCancel={() => setConflict(null)}
          busy={busy}
        />
      </ScrollView>
    );
  }

  if (pending) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#fff' }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 12 }}>
          Sales Report Import (CSV)
        </Text>
        <SalesPeriodConfirmStep
          suggestedStart={pending.suggestedStart}
          suggestedEnd={pending.suggestedEnd}
          summaryLine={`${pending.lineCount} product${pending.lineCount !== 1 ? 's' : ''} parsed.`}
          onConfirm={handlePeriodConfirm}
          onCancel={() => { setPending(null); setBusy(false); }}
          busy={busy}
        />
      </ScrollView>
    );
  }

  return (
    <View style={{ flex:1, padding:16, backgroundColor:'#fff' }}>
      <Text style={{ fontSize:18, fontWeight:'900', marginBottom:8 }}>Sales Report Import (CSV)</Text>
      <Text style={{ color:'#6B7280', marginBottom:12 }}>
        Export a CSV sales report from your POS and upload it here. PDF sales imports are coming soon.
      </Text>

      <TouchableOpacity
        disabled={busy}
        onPress={pickAndProcess}
        style={{ padding:14, borderRadius:12, backgroundColor:'#111' }}
      >
        <Text style={{ color:'#fff', fontWeight:'800', textAlign:'center' }}>
          {busy ? 'Reading your sales data...' : 'Upload Sales Report (CSV)'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        disabled={busy}
        onPress={onClose}
        style={{ padding:14, borderRadius:12, backgroundColor:'#F3F4F6', marginTop:12 }}
      >
        <Text style={{ color:'#111', fontWeight:'800', textAlign:'center' }}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}
