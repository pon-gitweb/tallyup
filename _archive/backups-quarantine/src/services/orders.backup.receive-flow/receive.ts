import { getFirestore, doc, updateDoc, serverTimestamp, collection, setDoc } from 'firebase/firestore';
import { getApp } from 'firebase/app';

// Updated to match the calling code in OrderDetailScreen
export async function finalizeReceiveFromCsv(params: {
  venueId: string;
  orderId: string;
  parsed: {
    invoice: any;
    lines: Array<{ productId?: string; code?: string; name: string; qty: number; unitPrice?: number }>;
    matchReport?: any;
    confidence?: number;
    warnings?: string[];
  };
  poNumber?: string | null;
  poDate?: any;
}): Promise<void> {
  const db = getFirestore(getApp());
  
  try {
    const { venueId, orderId, parsed } = params;
    const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
    
    await updateDoc(orderRef, {
      status: 'received',
      displayStatus: 'Received',
      receivedAt: serverTimestamp(),
      csvReceipt: {
        storagePath: parsed.invoice?.storagePath,
        confidence: parsed.confidence,
        processedAt: serverTimestamp(),
        matchedLines: parsed.lines?.length || 0
      },
      updatedAt: serverTimestamp()
    });

    // Create received lines subcollection entries
    if (parsed.lines && parsed.lines.length > 0) {
      const receivedLinesCol = collection(db, 'venues', venueId, 'orders', orderId, 'receivedLines');
      
      for (const line of parsed.lines) {
        const lineRef = doc(receivedLinesCol);
        await setDoc(lineRef, {
          productId: line.productId,
          code: line.code,
          name: line.name,
          qty: line.qty,
          unitPrice: line.unitPrice,
          receivedAt: serverTimestamp(),
          source: 'csv_upload'
        });
      }
    }

    console.log('[receive] CSV receive finalized', { venueId, orderId, lines: parsed.lines?.length });
  } catch (error) {
    console.error('[receive] CSV receive failed', error);
    throw error;
  }
}

export async function finalizeReceiveManual(
  venueId: string,
  orderId: string,
  manualQuantities: Array<{ productId: string; receivedQty: number }>
): Promise<void> {
  const db = getFirestore(getApp());
  
  try {
    const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
    
    await updateDoc(orderRef, {
      status: 'received',
      displayStatus: 'Received',
      receivedAt: serverTimestamp(),
      manualReceive: true,
      updatedAt: serverTimestamp()
    });

    // Create received lines for manual entry
    const receivedLinesCol = collection(db, 'venues', venueId, 'orders', orderId, 'receivedLines');
    
    for (const item of manualQuantities) {
      const lineRef = doc(receivedLinesCol);
      await setDoc(lineRef, {
        productId: item.productId,
        receivedQty: item.receivedQty,
        receivedAt: serverTimestamp(),
        source: 'manual'
      });
    }

    console.log('[receive] Manual receive finalized', { venueId, orderId, items: manualQuantities.length });
  } catch (error) {
    console.error('[receive] Manual receive failed', error);
    throw error;
  }
}
