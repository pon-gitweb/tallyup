// @ts-nocheck
import React from 'react';
import { ActivityIndicator, View, Linking } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';

import AuthNavigator from './AuthNavigator';
import MainStack from './stacks/MainStack';
import AuthGate from './AuthGate';
import OfflineBanner from '../components/OfflineBanner';
import WelcomeBetaScreen from '../screens/WelcomeBetaScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: 'white' },
};

const WELCOME_STORAGE_KEY = 'tallyup_welcome_seen_v1';
const PENDING_INVITE_KEY = 'tallyup_pending_invite_v1';

export const navigationRef = createNavigationContainerRef();

function parseInviteUrl(url: string): { venueId: string; inviteId: string } | null {
  try {
    const match = url.match(/tallyup:\/\/invite\/([^/?#]+)\/([^/?#]+)/);
    if (match && match[1] && match[2]) {
      return { venueId: match[1], inviteId: match[2] };
    }
  } catch {}
  return null;
}

function navigateToInvite(params: { venueId: string; inviteId: string }) {
  if (navigationRef.isReady()) {
    navigationRef.navigate('AcceptInvite', params);
  }
}

function AuthedStack({ pendingInvite, clearPendingInvite }: {
  pendingInvite: { venueId: string; inviteId: string } | null;
  clearPendingInvite: () => void;
}) {
  const [initialRoute, setInitialRoute] = React.useState(null);
  const inviteNavigatedRef = React.useRef(false);

  React.useEffect(() => {
    let isMounted = true;
    async function checkWelcome() {
      try {
        const seen = await AsyncStorage.getItem(WELCOME_STORAGE_KEY);
        if (!isMounted) return;
        setInitialRoute(seen ? 'Main' : 'WelcomeBeta');
      } catch {
        if (!isMounted) return;
        setInitialRoute('Main');
      }
    }
    checkWelcome();
    return () => { isMounted = false; };
  }, []);

  // Navigate to AcceptInvite once navigator is ready and invite is pending
  React.useEffect(() => {
    if (!pendingInvite || !initialRoute || inviteNavigatedRef.current) return;
    inviteNavigatedRef.current = true;
    const t = setTimeout(() => {
      if (navigationRef.isReady()) {
        navigationRef.navigate('AcceptInvite', pendingInvite);
        clearPendingInvite();
      }
    }, 400);
    return () => clearTimeout(t);
  }, [pendingInvite, initialRoute]);

  if (initialRoute == null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#0F172A" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {initialRoute === 'WelcomeBeta' && (
        <Stack.Screen name="WelcomeBeta" component={WelcomeBetaScreen} />
      )}
      <Stack.Screen name="Main" component={MainStack} />
    </Stack.Navigator>
  );
}

export default function RootNavigator() {
  const [pendingInvite, setPendingInvite] = React.useState<{ venueId: string; inviteId: string } | null>(null);
  const pendingInviteRef = React.useRef<{ venueId: string; inviteId: string } | null>(null);

  // Persist pending invite to AsyncStorage so it survives auth flow
  const storePendingInvite = React.useCallback(async (params: { venueId: string; inviteId: string }) => {
    pendingInviteRef.current = params;
    setPendingInvite(params);
    try { await AsyncStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(params)); } catch {}
  }, []);

  const clearPendingInvite = React.useCallback(async () => {
    pendingInviteRef.current = null;
    setPendingInvite(null);
    try { await AsyncStorage.removeItem(PENDING_INVITE_KEY); } catch {}
  }, []);

  React.useEffect(() => {
    // Restore any pending invite stored from before auth
    AsyncStorage.getItem(PENDING_INVITE_KEY).then((stored) => {
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.venueId && parsed?.inviteId) {
            pendingInviteRef.current = parsed;
            setPendingInvite(parsed);
          }
        } catch {}
      }
    }).catch(() => {});

    // Handle initial URL (app opened via invite link)
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const invite = parseInviteUrl(url);
      if (invite) storePendingInvite(invite);
    }).catch(() => {});

    // Handle URL events while app is in foreground/background
    const sub = Linking.addEventListener('url', ({ url }) => {
      const invite = parseInviteUrl(url);
      if (invite) {
        storePendingInvite(invite);
        // If navigator is already mounted, navigate directly
        if (navigationRef.isReady()) {
          navigationRef.navigate('AcceptInvite', invite);
          clearPendingInvite();
        }
      }
    });

    return () => sub.remove();
  }, [storePendingInvite, clearPendingInvite]);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <OfflineBanner />
      <AuthGate
        renderAuthed={() => (
          <AuthedStack
            pendingInvite={pendingInvite}
            clearPendingInvite={clearPendingInvite}
          />
        )}
        renderUnauthed={() => (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Auth" component={AuthNavigator} />
          </Stack.Navigator>
        )}
      />
    </NavigationContainer>
  );
}
