// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { useColours, useTheme } from '../../context/ThemeContext';
import { buildCrowdFlowIntelligence, CrowdFlowIntelligence } from '../../services/festival/crowdFlowIntelligence';

export default function FestivalCrowdFlowScreen() {
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [intel, setIntel] = useState<CrowdFlowIntelligence | null>(null);

  useEffect(() => {
    if (!venueId) return;
    (async () => {
      try {
        const sessSnap = await getDocs(
          query(collection(db, 'venues', venueId, 'sessions'), orderBy('completedAt', 'asc'))
        );
        const allSessions = sessSnap.docs.map(d => d.data());
        setIntel(buildCrowdFlowIntelligence(allSessions));
      } catch {}
      setLoading(false);
    })();
  }, [venueId]);

  if (loading) return (
    <View style={{ flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={c.deepBlue} size="large" />
    </View>
  );

  if (!intel || intel.hourSnapshots.length === 0) return (
    <View style={{ flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
      <Text style={{ fontSize: 40, marginBottom: 16 }}>🎪</Text>
      <Text style={{ fontSize: 18, fontWeight: '900', color: c.navy, textAlign: 'center', marginBottom: 8 }}>
        No flow data yet
      </Text>
      <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'center' }}>
        Complete at least 3 session counts across 2 or more bars to see crowd movement patterns.
      </Text>
    </View>
  );

  const barNames = intel.hourSnapshots.length > 0
    ? Object.keys(intel.hourSnapshots[0].barVelocities)
    : [];

  const barColors = ['#1b4f72', '#c47b2b', '#16a34a', '#dc2626', '#7c3aed', '#0891b2'];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.oat }} contentContainerStyle={{ padding: 16, gap: 12 }}>

      {/* Header */}
      <Text style={{ fontSize: 22, fontWeight: '900', color: c.navy, marginBottom: 4 }}>
        Crowd Flow
      </Text>
      <Text style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        Inferred from bar velocity data — no GPS needed
      </Text>

      {/* Opening and closing patterns */}
      {(intel.openingPattern || intel.closingPattern) && (
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8' }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: c.navy, marginBottom: 10 }}>📊 Event Pattern</Text>
          {intel.openingPattern && (
            <Text style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>🌅 {intel.openingPattern}</Text>
          )}
          {intel.closingPattern && (
            <Text style={{ fontSize: 13, color: '#374151' }}>🌙 {intel.closingPattern}</Text>
          )}
        </View>
      )}

      {/* Hour-by-hour bar comparison */}
      <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8' }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: c.navy, marginBottom: 4 }}>
          ⏱ Bar Activity by Hour
        </Text>
        <Text style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
          Bar height = relative velocity. Taller = more people.
        </Text>

        {/* Legend */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {barNames.map((name, i) => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: barColors[i % barColors.length] }} />
              <Text style={{ fontSize: 11, color: '#374151' }}>{name}</Text>
            </View>
          ))}
        </View>

        {/* Grouped bar chart per hour */}
        {intel.hourSnapshots.map(snapshot => {
          const maxVel = Math.max(...Object.values(snapshot.barVelocities), 1);
          return (
            <View key={snapshot.hour} style={{ marginBottom: 10 }}>
              <Text style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{snapshot.label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 40 }}>
                {barNames.map((name, i) => {
                  const vel = snapshot.barVelocities[name] || 0;
                  const heightPct = vel / maxVel;
                  const isBusiest = name === snapshot.busiestBar;
                  return (
                    <View key={name} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 40 }}>
                      <View style={{
                        width: '80%',
                        height: Math.max(2, Math.round(heightPct * 36)),
                        backgroundColor: barColors[i % barColors.length],
                        borderRadius: 3,
                        opacity: isBusiest ? 1 : 0.5,
                      }} />
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      {/* Flow events */}
      {intel.flowEvents.length > 0 && (
        <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e1d8' }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: c.navy, marginBottom: 10 }}>
            🌊 Crowd Movement Events
          </Text>
          {intel.flowEvents.map((event, i) => (
            <View key={i} style={{
              flexDirection: 'row', alignItems: 'flex-start', gap: 10,
              paddingVertical: 8,
              borderTopWidth: i > 0 ? 1 : 0, borderTopColor: '#f0ede6',
            }}>
              <View style={{
                backgroundColor: event.confidence === 'high' ? '#dc2626' : event.confidence === 'medium' ? '#c47b2b' : '#6b7280',
                borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2,
              }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff', textTransform: 'uppercase' }}>
                  {event.confidence}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.navy }}>{event.label}</Text>
                <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{event.description}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Staffing insights */}
      {intel.staffingInsights.length > 0 && (
        <View style={{ backgroundColor: '#eff6ff', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#1b4f72' }}>
          <Text style={{ fontSize: 15, fontWeight: '900', color: '#1b4f72', marginBottom: 10 }}>
            👥 Staffing Intelligence
          </Text>
          {intel.staffingInsights.map((insight, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: i < intel.staffingInsights.length - 1 ? 8 : 0 }}>
              <Text style={{ fontSize: 14, color: '#1b4f72' }}>•</Text>
              <Text style={{ fontSize: 13, color: '#1b4f72', flex: 1, lineHeight: 18 }}>{insight}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 10, fontStyle: 'italic' }}>
            Patterns improve with each event — more sessions = more accurate staffing predictions
          </Text>
        </View>
      )}

      {/* Future hook */}
      <View style={{ backgroundColor: '#f9fafb', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#e5e7eb', marginBottom: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 4 }}>
          Coming soon — Performance correlation
        </Text>
        <Text style={{ fontSize: 12, color: '#9ca3af' }}>
          Assign stages and set times to see which acts drove crowd movement to which bars. Unlocks "DJ Sola always peaks Main Stage Bar — stock up before their set."
        </Text>
      </View>

    </ScrollView>
  );
}
