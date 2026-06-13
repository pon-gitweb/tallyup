// @ts-nocheck
import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from '../services/firebase';
import { useColours } from '../context/ThemeContext';

type Props = { renderAuthed: () => JSX.Element; renderUnauthed: () => JSX.Element; };

export default function AuthGate({ renderAuthed, renderUnauthed }: Props) {
  const c = useColours();
  const [initializing, setInitializing] = React.useState(true);
  const [user, setUser] = React.useState<User | null>(null);

  React.useEffect(() => {
    // Failsafe — if auth state never resolves within 12 seconds, stop
    // showing the spinner and fall through to the auth stack (login).
    const failsafe = setTimeout(() => {
      setInitializing((prev) => (prev ? false : prev));
    }, 12000);

    const unsub = onAuthStateChanged(auth, (u) => {
      clearTimeout(failsafe);
      setUser(u);
      setInitializing(false);
      console.log('[AuthGate] user=', !!u);
    });
    return () => {
      clearTimeout(failsafe);
      unsub();
    };
  }, []);

  if (initializing) {
    return (
      <View style={{ flex: 1, backgroundColor: c.navy, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={c.oat} />
      </View>
    );
  }
  return user ? renderAuthed() : renderUnauthed();
}
