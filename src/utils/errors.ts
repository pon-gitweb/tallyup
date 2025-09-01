import { Alert } from 'react-native';

export type AppErrorSeverity = 'info' | 'warn' | 'error' | 'fatal';

export class AppError extends Error {
  code?: string;
  hint?: string;
  severity: AppErrorSeverity;
  cause?: unknown;
  context?: Record<string, unknown>;
  constructor(opts: { message: string; code?: string; hint?: string; severity?: AppErrorSeverity; cause?: unknown; context?: Record<string, unknown>; }) {
    super(opts.message);
    this.name = 'AppError';
    this.code = opts.code;
    this.hint = opts.hint;
    this.severity = opts.severity ?? 'error';
    this.cause = opts.cause;
    this.context = opts.context;
  }
}

function mapFirebaseCode(code?: string) {
  switch (code) {
    case 'permission-denied': return { message: 'You don’t have permission to do that.', hint: 'Check you’re attached to this venue and your role allows this action.' };
    case 'unauthenticated':  return { message: 'Please sign in to continue.', hint: 'Your session may have expired.' };
    case 'not-found':        return { message: 'That item could not be found.', hint: 'It might have been deleted or moved. Try refreshing.' };
    case 'already-exists':   return { message: 'That already exists.', hint: 'Try a different name or check duplicates.' };
    case 'failed-precondition': return { message: 'Action not allowed in current state.', hint: 'For example: area already completed; reset cycle first.' };
    case 'unavailable':
    case 'deadline-exceeded':
    case 'resource-exhausted':
    case 'cancelled':
    case 'aborted':
      return { message: 'Network or service is temporarily unavailable.', hint: 'Check your connection and try again.' };
    default:
      return { message: 'Something went wrong.', hint: 'Please try again. If it persists, contact support.' };
  }
}

export function toAppError(err: unknown, context?: Record<string, unknown>): AppError {
  const any = err as any;
  const code: string | undefined = any?.code || any?.name;
  const mapped = mapFirebaseCode(code);
  return new AppError({ message: mapped.message, hint: mapped.hint, code, severity: (code === 'permission-denied' || code === 'unauthenticated') ? 'warn' : 'error', cause: err, context });
}

export function friendly(err: unknown): { title: string; body: string } {
  if (err instanceof AppError) {
    const title = err.message || 'Error';
    const hint = err.hint ? `\n\n${err.hint}` : '';
    return { title, body: hint.trim() };
  }
  const mapped = toAppError(err);
  const hint = mapped.hint ? `\n\n${mapped.hint}` : '';
  return { title: mapped.message, body: hint.trim() };
}

export function notifyError(err: unknown, fallbackTitle = 'Error') {
  const { title, body } = friendly(err);
  Alert.alert(title || fallbackTitle, body || undefined);
}

export function logError(err: unknown, where: string, extra?: Record<string, unknown>) {
  const payload = { where, errCode: (err as any)?.code, errMessage: (err as any)?.message || String(err), extra: extra || undefined };
  console.log('[TallyUp Error]', JSON.stringify(payload));
}
