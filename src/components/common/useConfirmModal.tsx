import React, { useCallback, useState } from 'react';
import { ConfirmModal } from './ConfirmModal';

type ConfirmConfig = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};

type ModalState = ConfirmConfig & { visible: boolean };

export function useConfirmModal() {
  const [state, setState] = useState<ModalState>({
    visible: false,
    title: '',
    onConfirm: () => {},
  });

  const confirm = useCallback((config: ConfirmConfig) => {
    setState({ ...config, visible: true });
  }, []);

  const hide = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }));
  }, []);

  const modal = (
    <ConfirmModal
      {...state}
      onCancel={hide}
      onConfirm={() => {
        state.onConfirm();
        hide();
      }}
    />
  );

  return { confirm, modal };
}
