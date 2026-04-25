// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  FlatList,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { db } from '../../services/firebase';
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  deleteDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDoc,
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';

const ROLES = ['owner', 'manager', 'staff'] as const;
type Role = typeof ROLES[number];

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

const ROLE_DESC: Record<Role, string> = {
  owner: 'Full access · cycle reset · manage team',
  manager: 'Approve counts · reports · invite staff',
  staff: 'Count stock · view orders',
};

type Member = {
  uid: string;
  role: Role;
  email?: string;
  displayName?: string;
  joinedAt?: any;
  status?: string;
};

type Invite = {
  id: string;
  email: string;
  role: Role;
  status: string;
  createdAt?: any;
  emailStatus?: string;
};

export default function TeamMembersScreen() {
  const colours = useColours();
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const auth = getAuth();
  const currentUid = auth.currentUser?.uid;

  const [myRole, setMyRole] = useState<Role | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('staff');
  const [sending, setSending] = useState(false);

  const isOwner = myRole === 'owner';
  const canInvite = myRole === 'owner' || myRole === 'manager';

  // Resolve current user's role
  useEffect(() => {
    if (!venueId || !currentUid) return;
    (async () => {
      try {
        const vSnap = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (vSnap.data() as any)?.ownerUid;
        if (ownerUid === currentUid) { setMyRole('owner'); return; }
        const mSnap = await getDoc(doc(db, 'venues', venueId, 'members', currentUid));
        setMyRole((mSnap.data() as any)?.role || null);
      } catch {}
    })();
  }, [venueId, currentUid]);

  // Subscribe to members
  useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'members'), (snap) => {
      const list: Member[] = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      setMembers(list);
      setLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  // Subscribe to pending invites
  useEffect(() => {
    if (!venueId) return;
    const q = query(collection(db, 'venues', venueId, 'invites'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, (snap) => {
      const list: Invite[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setInvites(list);
    });
    return () => unsub();
  }, [venueId]);

  const sendInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    if (!canInvite) {
      Alert.alert('Permission denied', 'Only owners and managers can invite staff.');
      return;
    }
    // Only owners can invite managers
    if (inviteRole === 'manager' && !isOwner) {
      Alert.alert('Permission denied', 'Only owners can invite managers.');
      return;
    }
    if (inviteRole === 'owner' && !isOwner) {
      Alert.alert('Permission denied', 'Only owners can invite owners.');
      return;
    }

    // Check not already a member
    const alreadyMember = members.some((m) => m.uid === email || (m as any).email?.toLowerCase() === email);
    if (alreadyMember) {
      Alert.alert('Already a member', 'This person is already in your venue.');
      return;
    }

    // Check no pending invite for same email
    const alreadyInvited = invites.some((i) => i.email.toLowerCase() === email);
    if (alreadyInvited) {
      Alert.alert('Already invited', 'There is already a pending invite for this email.');
      return;
    }

    setSending(true);
    try {
      await addDoc(collection(db, 'venues', venueId, 'invites'), {
        email,
        role: inviteRole,
        invitedBy: currentUid || null,
        createdAt: serverTimestamp(),
        status: 'pending',
      });
      setInviteEmail('');
      setInviteRole('staff');
      setInviteModalOpen(false);
      Alert.alert('Invite sent', `An invite email has been sent to ${email}.`);
    } catch (e: any) {
      Alert.alert('Failed to send invite', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  };

  const cancelInvite = (invite: Invite) => {
    Alert.alert('Cancel invite', `Cancel the invite for ${invite.email}?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel invite', style: 'destructive', onPress: async () => {
          try {
            await deleteDoc(doc(db, 'venues', venueId, 'invites', invite.id));
          } catch (e: any) {
            Alert.alert('Error', e?.message ?? String(e));
          }
        },
      },
    ]);
  };

  const changeRole = (member: Member) => {
    if (!isOwner) {
      Alert.alert('Permission denied', 'Only owners can change roles.');
      return;
    }
    if (member.uid === currentUid) {
      Alert.alert('Cannot change your own role', 'Ask another owner to change your role.');
      return;
    }
    Alert.alert(
      'Change role',
      `Change role for ${member.displayName || member.email || member.uid}`,
      [
        ...ROLES.filter((r) => r !== member.role).map((r) => ({
          text: ROLE_LABELS[r],
          onPress: async () => {
            try {
              await updateDoc(doc(db, 'venues', venueId, 'members', member.uid), { role: r });
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? String(e));
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const removeMember = (member: Member) => {
    if (!isOwner) {
      Alert.alert('Permission denied', 'Only owners can remove members.');
      return;
    }
    if (member.uid === currentUid) {
      Alert.alert('Cannot remove yourself', 'Ask another owner to remove you.');
      return;
    }
    Alert.alert(
      'Remove member',
      `Remove ${member.displayName || member.email || member.uid} from this venue?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            try {
              await deleteDoc(doc(db, 'venues', venueId, 'members', member.uid));
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? String(e));
            }
          },
        },
      ]
    );
  };

  const S = makeStyles(colours);

  const renderMember = ({ item }: { item: Member }) => {
    const isMe = item.uid === currentUid;
    const name = item.displayName || item.email || item.uid;
    const roleColour = item.role === 'owner' ? colours.danger : item.role === 'manager' ? colours.primary : colours.textSecondary;
    return (
      <TouchableOpacity
        style={S.row}
        onLongPress={() => isOwner && !isMe ? showMemberActions(item) : null}
        activeOpacity={0.8}
      >
        <View style={S.rowInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={S.name}>{name}</Text>
            {isMe && <Text style={S.meTag}>you</Text>}
          </View>
          <Text style={[S.roleTag, { color: roleColour }]}>{ROLE_LABELS[item.role] || item.role}</Text>
          {item.email && item.displayName ? <Text style={S.email}>{item.email}</Text> : null}
        </View>
        {isOwner && !isMe && (
          <TouchableOpacity style={S.actionBtn} onPress={() => showMemberActions(item)}>
            <Text style={S.actionBtnText}>•••</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const showMemberActions = (member: Member) => {
    const name = member.displayName || member.email || member.uid;
    Alert.alert(name, ROLE_LABELS[member.role], [
      { text: 'Change role', onPress: () => changeRole(member) },
      { text: 'Remove member', style: 'destructive', onPress: () => removeMember(member) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderInvite = ({ item }: { item: Invite }) => {
    const statusLabel = item.emailStatus === 'sent' ? 'Email sent' : item.emailStatus === 'error' ? 'Email failed' : 'Sending…';
    return (
      <View style={[S.row, { backgroundColor: '#FFFBEB' }]}>
        <View style={S.rowInfo}>
          <Text style={S.name}>{item.email}</Text>
          <Text style={[S.roleTag, { color: colours.textSecondary }]}>
            {ROLE_LABELS[item.role] || item.role} · Pending
          </Text>
          <Text style={{ fontSize: 11, color: colours.textSecondary, marginTop: 2 }}>{statusLabel}</Text>
        </View>
        {canInvite && (
          <TouchableOpacity style={[S.actionBtn, { borderColor: colours.danger }]} onPress={() => cancelInvite(item)}>
            <Text style={[S.actionBtnText, { color: colours.danger }]}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colours.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colours.text }}>Team Members</Text>
          {canInvite && (
            <TouchableOpacity
              style={{ backgroundColor: colours.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 }}
              onPress={() => setInviteModalOpen(true)}
            >
              <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 14 }}>+ Invite</Text>
            </TouchableOpacity>
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={colours.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Current members */}
            <Text style={S.sectionTitle}>Members ({members.length})</Text>
            {members.length === 0 ? (
              <Text style={S.empty}>No members yet.</Text>
            ) : (
              members.map((m) => <View key={m.uid}>{renderMember({ item: m })}</View>)
            )}

            {/* Pending invites */}
            {invites.length > 0 && (
              <>
                <Text style={[S.sectionTitle, { marginTop: 24 }]}>Pending invites ({invites.length})</Text>
                {invites.map((inv) => <View key={inv.id}>{renderInvite({ item: inv })}</View>)}
              </>
            )}

            {/* Role explanation */}
            <Text style={[S.sectionTitle, { marginTop: 24 }]}>Role permissions</Text>
            {ROLES.map((r) => (
              <View key={r} style={S.roleCard}>
                <Text style={{ fontWeight: '800', color: colours.text, fontSize: 14 }}>{ROLE_LABELS[r]}</Text>
                <Text style={{ color: colours.textSecondary, fontSize: 13, marginTop: 2 }}>{ROLE_DESC[r]}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Invite modal */}
      <Modal
        visible={inviteModalOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInviteModalOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: colours.background }}>
          <View style={S.modalHeader}>
            <TouchableOpacity onPress={() => { setInviteModalOpen(false); setInviteEmail(''); setInviteRole('staff'); }}>
              <Text style={{ color: colours.textSecondary, fontSize: 16 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colours.text }}>Invite Staff Member</Text>
            <TouchableOpacity onPress={sendInvite} disabled={sending}>
              <Text style={{ color: colours.primary, fontSize: 16, fontWeight: '800', opacity: sending ? 0.5 : 1 }}>
                {sending ? 'Sending…' : 'Send'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <View>
              <Text style={S.label}>Email address</Text>
              <TextInput
                style={S.input}
                value={inviteEmail}
                onChangeText={setInviteEmail}
                placeholder="staff@yourvenue.com"
                placeholderTextColor={colours.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
            </View>

            <View>
              <Text style={S.label}>Role</Text>
              {ROLES.filter((r) => r !== 'owner' || isOwner).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[S.roleOption, inviteRole === r && S.roleOptionSelected]}
                  onPress={() => setInviteRole(r)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[S.roleOptionTitle, inviteRole === r && { color: colours.primary }]}>
                      {ROLE_LABELS[r]}
                    </Text>
                    <Text style={S.roleOptionDesc}>{ROLE_DESC[r]}</Text>
                  </View>
                  {inviteRole === r && (
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colours.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '900' }}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ backgroundColor: '#EFF6FF', padding: 12, borderRadius: 10 }}>
              <Text style={{ fontSize: 13, color: '#1E40AF' }}>
                The invite link expires after 7 days. The recipient will receive an email with a link to join your venue.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    sectionTitle: {
      fontSize: 11,
      fontWeight: '900',
      color: c.textSecondary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    empty: { color: c.textSecondary, fontSize: 14, textAlign: 'center', paddingVertical: 20 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    rowInfo: { flex: 1 },
    name: { fontSize: 15, fontWeight: '700', color: c.text },
    meTag: {
      fontSize: 10,
      fontWeight: '800',
      color: c.primary,
      backgroundColor: '#EFF6FF',
      paddingHorizontal: 5,
      paddingVertical: 1,
      borderRadius: 4,
      textTransform: 'uppercase',
    },
    email: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    roleTag: { fontSize: 12, fontWeight: '700', marginTop: 2 },
    actionBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      marginLeft: 8,
    },
    actionBtnText: { color: c.textSecondary, fontWeight: '700', fontSize: 13 },
    roleCard: {
      backgroundColor: c.surface,
      borderRadius: 10,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: c.border,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.border,
    },
    label: {
      fontSize: 13,
      fontWeight: '800',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      padding: 12,
      fontSize: 16,
      color: c.text,
      backgroundColor: c.surface,
    },
    roleOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
      marginBottom: 8,
    },
    roleOptionSelected: {
      borderColor: c.primary,
      backgroundColor: '#EFF6FF',
    },
    roleOptionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: c.text,
    },
    roleOptionDesc: {
      fontSize: 12,
      color: c.textSecondary,
      marginTop: 2,
    },
  });
}
