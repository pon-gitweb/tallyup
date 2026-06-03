// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import {
  collection, doc, getDocs, query, where, orderBy, limit,
  setDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

// ─── Velocity helper ──────────────────────────────────────────────────────────

function calculateItemVelocity(productId: string, sessions: any[]): number | null {
  if (sessions.length < 2) return null;
  const sorted = [...sessions].sort(
    (a, b) => (a.completedAt?.toMillis?.() || 0) - (b.completedAt?.toMillis?.() || 0)
  );
  let totalUsage = 0;
  let totalHours = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevCount = prev.counts?.find((c: any) => c.productId === productId)?.actualCount ?? null;
    const currCount = curr.counts?.find((c: any) => c.productId === productId)?.actualCount ?? null;
    const received  = curr.counts?.find((c: any) => c.productId === productId)?.receivedQty ?? 0;
    if (prevCount === null || currCount === null) continue;
    const usage = prevCount + received - currCount;
    if (usage < 0) continue; // restock without count — skip interval
    const hours = ((curr.completedAt?.toMillis?.() || 0) - (prev.completedAt?.toMillis?.() || 0)) / 3_600_000;
    if (hours <= 0) continue;
    totalUsage += usage;
    totalHours += hours;
  }
  if (totalHours === 0) return null;
  return totalUsage / totalHours; // units per hour
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalSessionCountScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();
  const { barId, barName } = route.params || {};

  // Tracks whether we've navigated to AreaInventory (so we know to write session on return)
  const sessionStarted = useRef(false);
  const [navigated, setNavigated] = useState(false);

  // Navigate to AreaInventory once on mount (keep this screen in stack so we get focus back)
  useEffect(() => {
    if (!FESTIVAL_BETA || !barId || navigated) return;
    setNavigated(true);
    sessionStarted.current = true;
    nav.navigate('AreaInventory', {
      departmentId: barId,
      areaId: 'back-of-house',
      isFestivalSession: true,
      sessionLabel: 'Session count',
      barName: barName || '',
    });
  }, [barId, navigated]);

  // When user returns from AreaInventory: write session doc + recalculate velocity
  useFocusEffect(useCallback(() => {
    if (!sessionStarted.current || !venueId || !barId) return;
    sessionStarted.current = false; // prevent re-firing on next focus

    (async () => {
      try {
        const uid         = auth.currentUser?.uid ?? 'unknown';
        const displayName = auth.currentUser?.displayName ?? null;

        // Read current bar back-of-house items
        const itemsSnap = await getDocs(
          collection(db, 'venues', venueId, 'departments', barId, 'areas', 'back-of-house', 'items')
        );

        // Only write session if at least one item was counted in the last 15 minutes
        const fifteenMinsAgo = Date.now() - 15 * 60 * 1000;
        const recentlyCounted = itemsSnap.docs.some(d => {
          const ts = (d.data() as any).lastCountAt?.toMillis?.();
          return ts && ts > fifteenMinsAgo;
        });

        if (!recentlyCounted) {
          nav.goBack();
          return;
        }

        const items = itemsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        // Write session document (feeds into velocity service)
        const sessionRef = doc(collection(db, 'venues', venueId, 'sessions'));
        await setDoc(sessionRef, {
          barId,
          barName: barName || '',
          completedAt: serverTimestamp(),
          completedBy: uid,
          completedByName: displayName,
          sessionType: 'session-count',
          counts: items.map(item => ({
            productId:    item.id,
            productName:  item.name || item.id,
            actualCount:  item.lastCount ?? 0,
            openingCount: item.openingCount ?? item.lastCount ?? 0,
            receivedQty:  item.receivedQty ?? 0,
            variance:     (item.openingCount ?? 0) + (item.receivedQty ?? 0) - (item.lastCount ?? 0),
            costPrice:    item.costPrice ?? null,
          })),
        });

        // Load recent sessions to calculate velocity (need ≥2 sessions)
        const recentSessionsSnap = await getDocs(
          query(
            collection(db, 'venues', venueId, 'sessions'),
            where('barId', '==', barId),
            orderBy('completedAt', 'desc'),
            limit(5),
          )
        );

        if (recentSessionsSnap.docs.length >= 2) {
          const sessionDocs = recentSessionsSnap.docs.map(d => d.data());
          const confidence  = sessionDocs.length >= 3 ? 'medium' : 'low';
          const vBatch = writeBatch(db);

          for (const item of items) {
            const velocity = calculateItemVelocity(item.id, sessionDocs);
            if (velocity !== null && velocity >= 0) {
              vBatch.update(
                doc(db, 'venues', venueId, 'departments', barId, 'areas', 'back-of-house', 'items', item.id),
                { velocity, velocityUpdatedAt: serverTimestamp(), velocityConfidence: confidence },
              );
            }
          }

          await vBatch.commit();
        }

        nav.goBack();
      } catch (e: any) {
        console.error('[FestivalSessionCount] post-count write failed:', e?.message);
        nav.goBack();
      }
    })();
  }, [venueId, barId]));

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#1b4f72" size="large" />
    </View>
  );
}
