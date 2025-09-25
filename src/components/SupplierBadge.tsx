// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { getApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useVenueId } from 'src/context/VenueProvider';

function abbr3(name?: string | null, fallback?: string) {
  const s = (name || '').trim();
  if (s.length >= 3) return s.slice(0, 3).toUpperCase();
  const f = (fallback || '').trim();
  if (f.length >= 3) return f.slice(0, 3).toUpperCase();
  return (s || f || 'SUP').toUpperCase();
}

type Props = {
  supplierId: string;
  supplierName?: string | null;
  size?: number; // diameter
  style?: any;
};

export default function SupplierBadge({ supplierId, supplierName, size = 28, style }: Props) {
  const venueId = useVenueId();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      try {
        if (!venueId || !supplierId) return;
        const db = getFirestore(getApp());
        const snap = await getDoc(doc(db, 'venues', venueId, 'suppliers', supplierId));
        if (isMounted) {
          const v: any = snap.exists() ? snap.data() : null;
          setLogoUrl(v?.logoUrl || null);
        }
      } catch {
        if (isMounted) setLogoUrl(null);
      }
    }
    load();
    return () => { isMounted = false; };
  }, [venueId, supplierId]);

  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (logoUrl) {
    return <Image source={{ uri: logoUrl }} style={[dim, style]} resizeMode="cover" />;
  }

  return (
    <View style={[{ backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center' }, dim, style]}>
      <Text style={{ color: 'white', fontWeight: '800', fontSize: size * 0.38 }}>
        {abbr3(supplierName, supplierId)}
      </Text>
    </View>
  );
}
