import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const DEV_VENUE_ID = 'v_7ykrc92wuw58gbrgyicr7e';

export default function ReportsScreen() {
  const navigation = useNavigation();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>Reports</Text>
      <Text style={styles.caption}>Quick insights and variance views for your last completed cycles.</Text>

      <View style={styles.grid}>
        <ReportCard
          title="Last Cycle Summary"
          subtitle="Items counted, shortages/excess value, and top variances"
          onPress={() =>
            navigation.navigate('LastCycleSummary' as never, { venueId: DEV_VENUE_ID } as never)
          }
        />

        <ReportCard
          title="Variance Snapshot"
          subtitle="Shortages/excess vs par with value impact"
          onPress={() =>
            navigation.navigate('VarianceSnapshot' as never, { venueId: DEV_VENUE_ID } as never)
          }
        />
      </View>
    </ScrollView>
  );
}

function ReportCard({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.86} onPress={onPress}>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.cardSub}>{subtitle}</Text> : null}
      </View>
      <Text style={styles.cardCta}>Open ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
  },
  caption: {
    color: '#666',
    marginBottom: 4,
  },
  grid: {
    marginTop: 8,
    gap: 12,
  },
  card: {
    borderRadius: 14,
    backgroundColor: '#f6f6f7',
    padding: 14,
    borderWidth: 1,
    borderColor: '#ececec',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardBody: {
    flexShrink: 1,
    paddingRight: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  cardSub: {
    color: '#666',
  },
  cardCta: {
    fontWeight: '700',
  },
});
