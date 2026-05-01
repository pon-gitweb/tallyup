// @ts-nocheck
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { getAuth } from 'firebase/auth';
import { AI_BASE_URL } from '../config/ai';
import { navigationRef } from '../navigation/RootNavigator';

const HIDDEN_ON = new Set([
  'OnboardingRoad',
  'OnboardingFreshStart',
  'OnboardingBringData',
]);

type Message = { role: 'user' | 'assistant' | 'system'; text: string };

export default function IzzyAssistant() {
  const [routeName, setRouteName] = useState('');
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    const update = () => {
      if (navigationRef.isReady()) {
        setRouteName(navigationRef.getCurrentRoute()?.name || '');
      }
    };
    update();
    const unsub = navigationRef.addListener('state', update);
    return unsub;
  }, []);

  if (HIDDEN_ON.has(routeName)) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      const resp = await fetch(`${AI_BASE_URL}/api/izzy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: `[Current screen: ${routeName || 'Unknown'}] ${text}`,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      const answer = json?.answer || "I'm having trouble right now. Please try again.";
      setMessages(prev => [...prev, { role: 'assistant', text: answer }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', text: "I'm having trouble right now. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  const onClose = () => {
    setOpen(false);
    setMessages([]);
    setInput('');
  };

  const displayMessages: Message[] = messages.length
    ? messages
    : [{ role: 'system', text: "Hi! I'm Izzy. Ask me anything about using Hosti-Stock ✦" }];

  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={styles.fab} activeOpacity={0.85}>
        <Text style={styles.fabIcon}>✦</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
        <KeyboardAvoidingView
          style={styles.modalWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={styles.backdrop} onPress={onClose} activeOpacity={1} />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View>
                <Text style={styles.title}>✦ Izzy</Text>
                <Text style={styles.subtitle}>Your Hosti-Stock guide</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              ref={flatRef}
              data={displayMessages}
              keyExtractor={(_, i) => String(i)}
              contentContainerStyle={styles.messageList}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <View style={[
                  styles.bubble,
                  item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant,
                ]}>
                  <Text style={item.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
                    {item.text}
                  </Text>
                </View>
              )}
            />

            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#1b4f72" />
                <Text style={styles.loadingText}>Izzy is thinking…</Text>
              </View>
            )}

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="Ask Izzy something…"
                placeholderTextColor="#94a3b8"
                value={input}
                onChangeText={setInput}
                onSubmitEditing={send}
                returnKeyType="send"
                multiline={false}
              />
              <TouchableOpacity
                onPress={send}
                style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
                disabled={!input.trim() || loading}
              >
                <Text style={styles.sendText}>→</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 80,
    left: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1b4f72',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 999,
  },
  fabIcon: { fontSize: 20, color: '#fff' },
  modalWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 18, fontWeight: '800', color: '#1b4f72' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  closeBtn: { padding: 8 },
  closeX: { fontSize: 16, color: '#64748b', fontWeight: '600' },
  messageList: { padding: 12, gap: 8 },
  bubble: {
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    maxWidth: '85%',
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#1b4f72' },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: '#f1f5f9' },
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleTextAssistant: { color: '#0f172a', fontSize: 14, lineHeight: 20 },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  loadingText: { color: '#64748b', fontSize: 13, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  input: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1b4f72',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
