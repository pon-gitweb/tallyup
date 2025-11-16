// @ts-nocheck
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';

const STORAGE_KEY = 'tallyup_welcome_seen_v1';

export default function WelcomeBetaScreen() {
  const navigation = useNavigation();
  const [saving, setSaving] = React.useState(false);

  const completeWelcome = React.useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
    } catch (e) {
      console.warn('[WelcomeBeta] Failed to persist seen flag', e);
    } finally {
      // Ensure we always get to the main app even if storage fails
      // Reset so Main stack is the root (Dashboard etc).
      // "Main" is the name of the authed stack in RootNavigator.
      navigation.reset({
        index: 0,
        routes: [{ name: 'Main' as never }],
      });
    }
  }, [navigation, saving]);

  const handleStartTour = () => {
    // For now, "Start tour" behaves the same as skip, but in future
    // you can navigate to a guided tour flow instead.
    completeWelcome();
  };

  const handleSkip = () => {
    completeWelcome();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.logoWrap}>
          {/* Assumes your app icon is at ./assets/icon.png (per app.json). */}
          <Image
            source={require('../../assets/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appName}>TallyUp</Text>
          <Text style={styles.tagline}>Built for NZ hospitality</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.betaTitle}>Welcome to the BETA</Text>
          <Text style={styles.betaText}>
            You’re using a BETA version of TallyUp (also branded as Hosti-STOCK). It’s ready
            for real stocktakes and real venues, but we’re still polishing edges and adding features.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>What you can do</Text>

          <View style={styles.point}>
            <View style={styles.bullet} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointTitle}>Run real stocktakes</Text>
              <Text style={styles.pointText}>
                Stocktake by department and area with expected quantities, long-hold item options,
                and full audit history.
              </Text>
            </View>
          </View>

          <View style={styles.point}>
            <View style={styles.bullet} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointTitle}>Turn invoices into orders</Text>
              <Text style={styles.pointText}>
                Upload CSV or PDF invoices to reconcile deliveries, keep stock up-to-date,
                and streamline your ordering.
              </Text>
            </View>
          </View>

          <View style={styles.point}>
            <View style={styles.bullet} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointTitle}>Craft-It recipes</Text>
              <Text style={styles.pointText}>
                Build recipes from your products, see real COGS and GP, and connect batches
                back to stock and sales.
              </Text>
            </View>
          </View>

          <View style={styles.point}>
            <View style={styles.bullet} />
            <View style={styles.pointTextWrap}>
              <Text style={styles.pointTitle}>AI insights (early)</Text>
              <Text style={styles.pointText}>
                Get early AI suggestions for orders and variance insights, with paywalls and limits
                as described in your Truth Document.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Important notes</Text>
          <Text style={styles.noteText}>
            • This app is multi-venue and multi-user. Make sure you are in the correct venue before
            you do a stocktake or raise orders.{'\n\n'}
            • Some flows (like AI, invoice upload, and Craft-It) are being actively improved. If you
            hit something strange, let us know – that feedback shapes the production version.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={handleSkip}
          disabled={saving}
          style={[styles.button, styles.secondaryButton]}
        >
          <Text style={styles.secondaryButtonText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleStartTour}
          disabled={saving}
          style={[styles.button, styles.primaryButton]}
        >
          <Text style={styles.primaryButtonText}>Start tour</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const PRIMARY = '#0B132B';
const ACCENT = '#FF8A3D';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FB',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 24,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 12,
    borderRadius: 16,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: PRIMARY,
  },
  tagline: {
    fontSize: 14,
    color: '#5A6478',
    marginTop: 4,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  betaTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 8,
  },
  betaText: {
    fontSize: 14,
    color: '#333840',
    lineHeight: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 12,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: ACCENT,
    marginTop: 6,
    marginRight: 8,
  },
  pointTextWrap: {
    flex: 1,
  },
  pointTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY,
  },
  pointText: {
    fontSize: 13,
    color: '#4A4F5C',
    marginTop: 2,
    lineHeight: 18,
  },
  noteText: {
    fontSize: 13,
    color: '#4A4F5C',
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 4,
    gap: 12,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: PRIMARY,
  },
  primaryButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#CBD2E1',
  },
  secondaryButtonText: {
    color: PRIMARY,
    fontWeight: '500',
    fontSize: 15,
  },
});
