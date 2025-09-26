import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

export const PATCH1_ERROR_BOUNDARY_ENABLED = true;

type Props = {
  screenName: string;
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  error?: any;
};

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: undefined };
  }

  static getDerivedStateFromError(error: any): State {
    if (!PATCH1_ERROR_BOUNDARY_ENABLED) return { hasError: false, error: undefined };
    return { hasError: true, error };
  }

  componentDidCatch(error: any, info: any) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(`[ErrorBoundary:${this.props.screenName}]`, error, info);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (PATCH1_ERROR_BOUNDARY_ENABLED && this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', marginBottom: 8 }}>
            Something went wrong
          </Text>
          <Text style={{ color: '#6B7280', textAlign: 'center', marginBottom: 16 }}>
            {this.props.screenName} couldn’t load. You can retry to continue.
          </Text>
          <TouchableOpacity onPress={this.handleRetry}
            style={{ backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children as any;
  }
}

export const withErrorBoundary = <P extends object>(Comp: React.ComponentType<P>, screenName: string) => {
  const Wrapped: React.FC<P> = (props) => (
    <ErrorBoundary screenName={screenName}>
      <Comp {...(props as P)} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `WithErrorBoundary(${Comp.displayName || Comp.name || 'Component'})`;
  return Wrapped;
};
