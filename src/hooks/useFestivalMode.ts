import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useVenueId } from '../context/VenueProvider';

export function useFestivalMode() {
  const venueId = useVenueId();
  const [venueType, setVenueType] = useState<string | null>(null);

  useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId), (snap) => {
      if (snap.exists()) {
        setVenueType((snap.data() as any)?.venueType ?? null);
      }
    });
    return () => unsub();
  }, [venueId]);

  return {
    isFestival: venueType === 'festival',
    isPermanent: venueType !== 'festival',
  };
}
