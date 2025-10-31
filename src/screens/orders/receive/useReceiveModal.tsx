// @ts-nocheck
import React, { useMemo, useState, useEffect } from 'react';
import ReceiveOptionsModal from '../ReceiveOptionsModal';

export function useReceiveModal(opts: { orderId: string; orderLines?: any[] }) {
  const { orderId, orderLines } = opts;
  const [visible, setVisible] = useState(false);
  const openReceive = () => setVisible(true);
  const closeReceive = () => setVisible(false);

  const modalNode = useMemo(() => (
    <ReceiveOptionsModal
      visible={visible}
      onClose={closeReceive}
      orderId={orderId}
      orderLines={orderLines}
    />
  ), [visible, orderId, orderLines]);

  return { openReceive, modalNode };
}
export default useReceiveModal;
