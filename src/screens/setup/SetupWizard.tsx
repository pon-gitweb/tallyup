import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, signOut } from 'firebase/auth';

export default function SetupWizard() {
  const navigation = useNavigation<any>();

  const goCreate = () => {
    // Go to the lightweight Create Venue screen (owner flow)
    navigation.navigate('CreateVenue');
  };

  const backToLogin = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      console.log('[TallyUp CreateVenue] back-to-login signOut ok');
    } catch (e:any) {
      console.log('[TallyUp CreateVenue] back-to-login error', e?.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Let’s set up your venue</Text>
      <Text style={styles.p}>
        As the first user on this account you’ll create the venue you manage.
        You can invite staff later from Settings.
      </Text>

      <Pressable style={styles.primary} onPress={goCreate}>
        <Text style={styles.primaryLabel}>Create Venue (Owner)</Text>
      </Pressable>

      <Pressable style={styles.secondary} onPress={backToLogin}>
        <Text style={styles.secondaryLabel}>Back to Login</Text>
      </Pressable>

      <View style={{height:24}} />

      <Text style={styles.small}>
        Already part of a venue? Ask the owner to invite you, then sign in.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, padding:20, justifyContent:'center' },
  h1: { fontSize:24, fontWeight:'700', marginBottom:8 },
  p: { fontSize:16, opacity:0.8, marginBottom:24 },
  primary: { backgroundColor:'#1f6feb', padding:14, borderRadius:10, alignItems:'center' },
  primaryLabel: { color:'#fff', fontSize:16, fontWeight:'600' },
  secondary: { padding:14, borderRadius:10, alignItems:'center', borderWidth:1, borderColor:'#ccc', marginTop:12 },
  secondaryLabel: { fontSize:16, fontWeight:'600' },
  small: { fontSize:13, opacity:0.7 },
});
