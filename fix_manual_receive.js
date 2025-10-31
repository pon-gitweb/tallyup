// Replace the broken confirmManualReceive function in OrderDetailScreen.tsx (lines 126-134)
const confirmManualReceive = useCallback(async ()=>{
  try{
    if (!venueId || !orderId) return;
    
    // Use the manual receive service with current line quantities
    await finalizeReceiveManual(
      venueId, 
      orderId, 
      lines.map(line => ({
        productId: line.productId || line.id,
        receivedQty: line.qty || 0
      }))
    );
    
    console.log('[OrderDetail] manual receive: finalized ok');
    Alert.alert('Received', 'Order marked received manually.');
    setReceiveOpen(false);
    
    // Refresh the order data to show the new status
    const oSnap = await getDoc(doc(db, 'venues', venueId, 'orders', orderId));
    const oVal = oSnap.exists() ? oSnap.data() : {};
    setOrderMeta({ id: oSnap.id, ...oVal });
    
  }catch(e:any){
    console.error('[OrderDetail] manual receive failed', e);
    Alert.alert('Receive failed', String(e?.message || e));
  }
},[venueId, orderId, lines, db]);
