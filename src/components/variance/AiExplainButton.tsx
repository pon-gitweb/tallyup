// @ts-nocheck
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { isEntitled } from '../../services/entitlement';
import { explainVariance } from '../../services/aiExplain';
import { useToast } from '../common/Toast';

type Props = {
  departmentId?: string | null;
  // Optional: pass pre-trimmed items (your “data diet” list)
  items?: any[] | null;
  sinceDays?: number;
  label?: string; // override button text
};

export default function AiExplainButton({
  departmentId = null,
  items = null,
  sinceDays = 14,
  label,
}: Props) {
  const venueId = useVenueId();
  const { showError, showInfo } = useToast();

  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{ explanation: string; bullets: string[] }>({
    explanation: '',
    bullets: [],
  });

  const onPress = useCallback(async () => {
    if (!venueId) {
      showInfo('Please sign in and try again.');
      return;
    }

    // isEntitled() is currently hardcoded true (beta); gate is kept here for paid rollout.
    const ok = await isEntitled(venueId, '');
    if (!ok) {
      showInfo('AI variance explanations require the Ops Intelligence module. Visit Settings → Billing on desktop to subscribe.');
      return;
    }

    try {
      setLoading(true);
      const res = await explainVariance({ venueId, departmentId, items, sinceDays });
      setResult(res);
      setModalOpen(true);
    } catch (e: any) {
      showError(e?.message || 'Could not get AI explanation. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [venueId, departmentId, items, sinceDays]);

  return (
    <View>
      <TouchableOpacity
        style={[S.btn, loading && S.btnDisabled]}
        onPress={onPress}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={S.btnText}>{label || '🤖 Explain variance'}</Text>
        )}
      </TouchableOpacity>

      {/* Result modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={S.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable
            style={S.card}
            onPress={(e) => {
              e.stopPropagation();
            }}
          >
            <Text style={S.title}>AI Explanation</Text>
            <Text style={S.body}>{result.explanation || 'No explanation available.'}</Text>
            {Array.isArray(result.bullets) && result.bullets.length > 0 ? (
              <FlatList
                data={result.bullets}
                keyExtractor={(x, i) => String(i)}
                renderItem={({ item }) => <Text style={S.bullet}>• {String(item)}</Text>}
                style={{ marginTop: 8 }}
              />
            ) : null}
            <TouchableOpacity style={[S.btn, { marginTop: 12 }]} onPress={() => setModalOpen(false)}>
              <Text style={S.btnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  btn: {
    backgroundColor: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnDisabled: { backgroundColor: '#9CA3AF' },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 16 },
  title: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  body: { fontSize: 14, color: '#111827' },
  bullet: { fontSize: 14, color: '#111827', marginTop: 4 },
});
