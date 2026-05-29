// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, getDocs, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { apiBase } from '../../services/apiBase';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

type SalesUploadSummary = { count: number; lastPeriod: string | null };

type ChatMsg = { role: 'user' | 'assistant'; text: string };

export default function FestivalReportsScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [event, setEvent] = useState<any>(null);
  const [barCount, setBarCount] = useState(0);
  const [recentTransfers, setRecentTransfers] = useState(0);
  const [recentRequests, setRecentRequests] = useState(0);
  const [loading, setLoading] = useState(FESTIVAL_BETA);
  const [salesUploadSummary, setSalesUploadSummary] = useState<SalesUploadSummary>({ count: 0, lastPeriod: null });

  // Suitee chat
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      setEvent(snap.exists() ? snap.data() : null);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [venueId]);

  useEffect(() => {
    if (!venueId) return;
    getDocs(collection(db, 'venues', venueId, 'event', 'details', 'salesData'))
      .then(s => {
        const docs = s.docs.map(d => d.data() as any);
        const sorted = [...docs].sort((a, b) => {
          const at = a.uploadedAt?.toDate?.()?.getTime() ?? 0;
          const bt = b.uploadedAt?.toDate?.()?.getTime() ?? 0;
          return bt - at;
        });
        setSalesUploadSummary({
          count: docs.length,
          lastPeriod: sorted[0]?.periodLabel ?? null,
        });
      })
      .catch(() => {});
    getDocs(collection(db, 'venues', venueId, 'bars'))
      .then(s => setBarCount(s.size))
      .catch(() => {});
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    getDocs(collection(db, 'venues', venueId, 'transfers'))
      .then(s => setRecentTransfers(s.docs.filter(d => {
        const ts = (d.data() as any).createdAt?.toDate?.();
        return ts && ts >= since;
      }).length))
      .catch(() => {});
    getDocs(collection(db, 'venues', venueId, 'requests'))
      .then(s => setRecentRequests(s.docs.filter(d => {
        const ts = (d.data() as any).createdAt?.toDate?.();
        return ts && ts >= since;
      }).length))
      .catch(() => {});
  }, [venueId]);

  async function sendQuestion() {
    const q = input.trim();
    if (!q || asking || !venueId) return;
    setInput('');
    const userMsg: ChatMsg = { role: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setAsking(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    try {
      const token = await auth.currentUser?.getIdToken();
      const history = messages.map(m => ({ role: m.role, content: m.text }));
      const res = await fetch(`${apiBase()}/suitee`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q, venueId, history }),
      });
      const data = await res.json();
      const answer = data.answer || "I couldn't get a response right now.";
      setMessages(prev => [...prev, { role: 'assistant', text: answer }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: "Connection error — please try again." }]);
    } finally {
      setAsking(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }

  // Day/Week header helpers
  function getEventProgress() {
    if (!event?.startDate) return null;
    try {
      const [ds, ms, ys] = event.startDate.split('/');
      const [de, me, ye] = (event.endDate || event.startDate).split('/');
      const start = new Date(parseInt(ys), parseInt(ms) - 1, parseInt(ds));
      const end = new Date(parseInt(ye), parseInt(me) - 1, parseInt(de));
      const now = new Date();
      const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
      const dayNum = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000) + 1);
      return { dayNum: Math.min(dayNum, totalDays), totalDays };
    } catch { return null; }
  }
  const progress = getEventProgress();
  const weekNum = progress ? Math.ceil(progress.dayNum / 7) : null;
  const totalWeeks = progress ? Math.ceil(progress.totalDays / 7) : null;
  const isLongEvent = progress && progress.totalDays > 14;

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.container}>
        <Text style={S.emoji}>🎪</Text>
        <Text style={S.title}>Festival mode</Text>
        <Text style={S.body}>Coming soon — we'll let you know when it's live.</Text>
        <Text style={S.contact}>Questions? Email us at{'\n'}office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.container}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>

          {/* Header */}
          <Text style={S.heading}>Festival Briefing</Text>
          {event?.eventName && <Text style={S.sub}>{event.eventName}</Text>}
          {progress && (
            <Text style={S.progress}>
              Day {progress.dayNum} of {progress.totalDays}
              {isLongEvent ? ` · Week ${weekNum} of ${totalWeeks}` : ''}
            </Text>
          )}

          {/* Section 1: Live health numbers */}
          <View style={S.healthRow}>
            <HealthBox label="Active bars" value={barCount} icon="🍺" />
            <HealthBox label="Transfers (48h)" value={recentTransfers} icon="🔄" />
            <HealthBox label="Requests (48h)" value={recentRequests} icon="📤" />
          </View>

          {/* Section 2: Suitee inline chat */}
          <View style={S.chatCard}>
            <Text style={S.chatTitle}>✦ Ask Suitee</Text>
            <Text style={S.chatSub}>Ask anything about your stock, velocity, or returns.</Text>

            {messages.length === 0 && (
              <View style={S.suggestions}>
                {[
                  "What's my current stock health?",
                  "Which bars are running low?",
                  "Am I within my return allowance?",
                ].map(q => (
                  <TouchableOpacity key={q} style={S.suggestion} onPress={() => { setInput(q); }}>
                    <Text style={S.suggestionText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {messages.map((m, i) => (
              <View key={i} style={[S.bubble, m.role === 'user' ? S.bubbleUser : S.bubbleAssistant]}>
                <Text style={m.role === 'user' ? S.bubbleUserText : S.bubbleAssistantText}>{m.text}</Text>
              </View>
            ))}

            {asking && (
              <View style={S.bubbleAssistant}>
                <ActivityIndicator color="#1b4f72" size="small" />
              </View>
            )}

            <View style={S.inputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask about stock, velocity, returns..."
                placeholderTextColor="#9ca3af"
                style={S.input}
                onSubmitEditing={sendQuestion}
                returnKeyType="send"
                editable={!asking}
              />
              <TouchableOpacity style={[S.sendBtn, (!input.trim() || asking) && S.sendBtnDisabled]} onPress={sendQuestion} disabled={!input.trim() || asking}>
                <Text style={S.sendBtnText}>→</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Section 3: Report tiles */}
          <Text style={S.tilesHeading}>REPORTS</Text>
          <View style={S.tilesRow}>
            <ReportTile icon="📊" label="Stock overview" onPress={() => nav.navigate('FestivalStockOverview')} />
            <ReportTile icon="⚠" label="Return risk" onPress={() => nav.navigate('FestivalReturnRisk')} />
          </View>
          <View style={S.tilesRow}>
            <ReportTile icon="🔮" label="Purchasing prediction" onPress={() => nav.navigate('FestivalPurchasingPrediction')} />
            <ReportTile icon="📋" label="Reconciliation" onPress={() => nav.navigate('FestivalReconciliation')} />
          </View>
          <View style={S.tilesRow}>
            <TouchableOpacity style={S.salesTile} onPress={() => nav.navigate('FestivalSalesUpload')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={S.tileIcon}>📊</Text>
                <Text style={[S.tileLabel, { marginLeft: 6 }]}>Sales data</Text>
              </View>
              {salesUploadSummary.count > 0 ? (
                <Text style={S.salesTileSub}>
                  {salesUploadSummary.count} upload{salesUploadSummary.count > 1 ? 's' : ''}
                  {salesUploadSummary.lastPeriod ? ` · Last: ${salesUploadSummary.lastPeriod}` : ''}
                </Text>
              ) : (
                <Text style={S.salesTileEmpty}>No sales data yet — upload to improve velocity and reconciliation accuracy</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Section 4: Week review prompt (long events only) */}
          {isLongEvent && weekNum && (
            <View style={S.weekCard}>
              <Text style={S.weekTitle}>Week {weekNum} in progress</Text>
              <Text style={S.weekBody}>
                You're in Week {weekNum} of {totalWeeks}. Write a weekly snapshot or review the week before closing.
              </Text>
              <View style={S.weekBtnRow}>
                <TouchableOpacity style={S.weekBtn} onPress={() => nav.navigate('FestivalWeekReview', { weekNumber: weekNum })}>
                  <Text style={S.weekBtnText}>Review Week {weekNum} →</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function HealthBox({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <View style={S.healthBox}>
      <Text style={S.healthIcon}>{icon}</Text>
      <Text style={S.healthValue}>{value}</Text>
      <Text style={S.healthLabel}>{label}</Text>
    </View>
  );
}

function ReportTile({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={S.tile} onPress={onPress}>
      <Text style={S.tileIcon}>{icon}</Text>
      <Text style={S.tileLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  emoji: { fontSize: 52, marginBottom: 20, color: '#1b4f72' },
  title: { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16, letterSpacing: -0.3 },
  body: { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  contact: { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 2 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 2 },
  progress: { fontSize: 13, color: '#1b4f72', fontWeight: '600', marginBottom: 16 },

  healthRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  healthBox: { flex: 1, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 12, alignItems: 'center' },
  healthIcon: { fontSize: 22, marginBottom: 4 },
  healthValue: { fontSize: 22, fontWeight: '800', color: '#0B132B' },
  healthLabel: { fontSize: 10, color: '#9ca3af', fontWeight: '600', marginTop: 2, textAlign: 'center' },

  chatCard: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 16 },
  chatTitle: { fontSize: 15, fontWeight: '800', color: '#1b4f72', marginBottom: 2 },
  chatSub: { fontSize: 12, color: '#9ca3af', marginBottom: 10 },

  suggestions: { gap: 6, marginBottom: 10 },
  suggestion: { backgroundColor: '#eff6ff', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  suggestionText: { fontSize: 13, color: '#1b4f72', fontWeight: '500' },

  bubble: { borderRadius: 10, padding: 10, marginBottom: 6, maxWidth: '92%' },
  bubbleUser: { backgroundColor: '#1b4f72', alignSelf: 'flex-end' },
  bubbleAssistant: { backgroundColor: '#f3f4f6', alignSelf: 'flex-start' },
  bubbleUserText: { color: '#fff', fontSize: 14 },
  bubbleAssistantText: { color: '#0B132B', fontSize: 14, lineHeight: 20 },

  inputRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: { flex: 1, backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0f172a' },
  sendBtn: { backgroundColor: '#1b4f72', borderRadius: 10, width: 44, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#fff', fontWeight: '800', fontSize: 18 },

  tilesHeading: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 10, marginTop: 8 },
  tilesRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  tile: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e5e1d8', minHeight: 80 },
  tileIcon: { fontSize: 24, marginBottom: 6 },
  tileLabel: { fontSize: 12, fontWeight: '700', color: '#0B132B', textAlign: 'center' },
  salesTile: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#e5e1d8' },
  salesTileSub: { fontSize: 11, color: '#6b7280' },
  salesTileEmpty: { fontSize: 11, color: '#9ca3af', fontStyle: 'italic', lineHeight: 15 },

  weekCard: { backgroundColor: '#eff6ff', borderRadius: 12, borderWidth: 1, borderColor: '#bfdbfe', padding: 14, marginTop: 8 },
  weekTitle: { fontSize: 14, fontWeight: '800', color: '#1b4f72', marginBottom: 4 },
  weekBody: { fontSize: 13, color: '#374151', lineHeight: 19, marginBottom: 10 },
  weekBtnRow: { flexDirection: 'row', gap: 8 },
  weekBtn: { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  weekBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
