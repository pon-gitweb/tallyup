type ToastFn = (
  config:
    | string
    | { message: string; variant?: 'success' | 'error' | 'info'; duration?: number }
) => void;

let _show: ToastFn | null = null;
let _showError: ((msg: string) => void) | null = null;
let _showSuccess: ((msg: string) => void) | null = null;

export const toastService = {
  register(fns: {
    show: ToastFn;
    showError: (msg: string) => void;
    showSuccess: (msg: string) => void;
  }) {
    _show = fns.show;
    _showError = fns.showError;
    _showSuccess = fns.showSuccess;
  },
  show(msg: string | object) {
    _show?.(msg as any);
  },
  error(msg: string) {
    _showError?.(msg);
  },
  success(msg: string) {
    _showSuccess?.(msg);
  },
};
