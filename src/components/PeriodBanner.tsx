import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function endOfQuarter(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3);
  const lastMonth = q * 3 + 2;
  return new Date(d.getFullYear(), lastMonth + 1, 0);
}
function endOfYear(d = new Date()) {
  return new Date(d.getFullYear(), 12, 0);
}
function daysBetween(a: Date, b: Date) {
  const MS = 24 * 3600 * 1000;
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db.getTime() - da.getTime()) / MS);
}

export type PeriodBannerProps = {
  now?: Date;
  // tweak thresholds if needed
  eomThresholdDays?: number; // show when within N days of end of month
  eoqThresholdDays?: number; // end of quarter
  eoyThresholdDays?: number; // end of year
};

export default function PeriodBanner({
  now = new Date(),
  eomThresholdDays = 5,
  eoqThresholdDays = 10,
  eoyThresholdDays = 20,
}: PeriodBannerProps) {
  const info = useMemo(() => {
    const eom = endOfMonth(now);
    const eoq = endOfQuarter(now);
    const eoy = endOfYear(now);
    const dm = daysBetween(now, eom);
    const dq = daysBetween(now, eoq);
    const dy = daysBetween(now, eoy);

    // Choose the most urgent approaching period
    const candidates: Array<{key:'EOM'|'EOQ'|'EOY'; inDays:number; date:Date; blurb:string}> = [];
    if (dm >= 0 && dm <= eomThresholdDays) candidates.push({ key:'EOM', inDays: dm, date: eom, blurb: 'Month-end is near' });
    if (dq >= 0 && dq <= eoqThresholdDays) candidates.push({ key:'EOQ', inDays: dq, date: eoq, blurb: 'Quarter-end is near' });
    if (dy >= 0 && dy <= eoyThresholdDays) candidates.push({ key:'EOY', inDays: dy, date: eoy, blurb: 'Year-end is near' });
    candidates.sort((a,b) => a.inDays - b.inDays);

    const chosen = candidates[0];
    if (!chosen) return null;

    const dateStr = chosen.date.toLocaleDateString();
    const when = chosen.inDays === 0 ? 'today' : chosen.inDays === 1 ? 'tomorrow' : `in ${chosen.inDays} days`;

    const tipsByKey = {
      EOM: 'Finish all areas, then tap “Complete Venue Stock Take” to lock in counts for month-end.',
      EOQ: 'Aim to complete every department before quarter closes. Lock the venue when all are green.',
      EOY: 'Complete all departments and finalize to archive the year’s final stock take.',
    } as const;

    return {
      title: chosen.blurb,
      subtitle: `Ends ${when} (${dateStr}). ${tipsByKey[chosen.key]}`,
    };
  }, [now, eomThresholdDays, eoqThresholdDays, eoyThresholdDays]);

  if (!info) return null;
  return (
    <View style={S.wrap}>
      <Text style={S.title}>{info.title}</Text>
      <Text style={S.subtitle}>{info.subtitle}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { backgroundColor: '#E8F1FF', padding: 12, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#D7E6FF' },
  title: { color: '#0A4C9A', fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#0A4C9A' },
});
