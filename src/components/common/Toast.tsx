import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useColours } from '../../context/ThemeContext';
import { toastService } from '../../utils/toastService';

type ToastVariant = 'success' | 'error' | 'info';

type ToastConfig = {
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastContextType = {
  show: (config: ToastConfig | string) => void;
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  showInfo: (message: string) => void;
};

type ToastRenderContextType = {
  visible: boolean;
  config: ToastConfig;
  translateY: Animated.Value;
};

const ToastContext = createContext<ToastContextType | null>(null);
const ToastRenderContext = createContext<ToastRenderContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [config, setConfig] = useState<ToastConfig>({ message: '', variant: 'success' });
  const translateY = useRef(new Animated.Value(-100)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (input: ToastConfig | string) => {
      const cfg: ToastConfig =
        typeof input === 'string' ? { message: input, variant: 'success' } : input;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      setConfig(cfg);
      setVisible(true);

      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 100,
        friction: 8,
      }).start();

      timerRef.current = setTimeout(() => {
        Animated.timing(translateY, {
          toValue: -100,
          duration: 250,
          useNativeDriver: true,
        }).start(() => setVisible(false));
      }, cfg.duration ?? 2500);
    },
    [translateY]
  );

  const showError = useCallback(
    (message: string) => show({ message, variant: 'error', duration: 3500 }),
    [show]
  );

  const showSuccess = useCallback(
    (message: string) => show({ message, variant: 'success' }),
    [show]
  );

  const showInfo = useCallback(
    (message: string) => show({ message, variant: 'info' }),
    [show]
  );

  useEffect(() => {
    toastService.register({ show, showError, showSuccess });
  }, [show, showError, showSuccess]);

  return (
    <ToastContext.Provider value={{ show, showError, showSuccess, showInfo }}>
      <ToastRenderContext.Provider value={{ visible, config, translateY }}>
        <View style={styles.wrapper}>
          {children}
          <ToastHost />
        </View>
      </ToastRenderContext.Provider>
    </ToastContext.Provider>
  );
}

export function ToastHost() {
  const c = useColours();
  const ctx = useContext(ToastRenderContext);
  if (!ctx) return null;
  const { visible, config, translateY } = ctx;

  const bgColor = {
    success: '#2d6a4f',
    error: '#c0392b',
    info: c.missionSlate ?? '#3b3f4a',
  }[config.variant ?? 'success'];

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.toast, { backgroundColor: bgColor, transform: [{ translateY }] }]}
    >
      <Text style={styles.toastText} numberOfLines={2}>
        {config.message}
      </Text>
    </Animated.View>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 52,
    paddingBottom: 16,
    paddingHorizontal: 20,
    zIndex: 9999,
    elevation: 20,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    lineHeight: 20,
  },
});
