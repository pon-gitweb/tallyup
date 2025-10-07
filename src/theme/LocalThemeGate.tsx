import React from 'react';

type Props = {
  children: React.ReactNode;
};

/**
 * LocalThemeGate (shim)
 * No-op wrapper so screens import cleanly even if the brand theme system isn't present.
 * Replace with real theming later.
 */
export default function LocalThemeGate({ children }: Props) {
  return <>{children}</>;
}
