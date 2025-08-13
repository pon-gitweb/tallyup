import React from 'react';
import { View, ActivityIndicator, Text } from 'react-native';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from 'src/services/firebase';

type Props = { renderAuthed: () => JSX.Element; renderUnauthed: () => JSX.Element; };

export default function AuthGate({ renderAuthed, renderUnauthed }: Props) {
  const [initializing, setInitializing] = React.useState(true);
  const [user, setUser] = React.useState<User | null>(null);

  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setInitializing(false);
      console.log('[AuthGate] user=', !!u);
    });
    return () => unsub();
  }, []);

  if (initializing) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Checking sign-in…</Text>
      </View>
    );
  }
  return user ? renderAuthed() : renderUnauthed();
}
