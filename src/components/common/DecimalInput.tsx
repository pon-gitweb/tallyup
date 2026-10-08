import React, { useEffect, useRef, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import type { TextInputProps } from 'react-native';

interface DecimalInputProps extends Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> {
  value: number | null | undefined;
  onChangeNumber: (n: number | null) => void;
  maxDecimals?: number;
}

function parse(text: string): number | null {
  if (text === '' || text === '.') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalise(text: string): string {
  // Drop trailing '.'; drop leading zeros except '0.x'
  let t = text.replace(/\.$/, '');
  t = t.replace(/^0+(\d)/, '$1');
  return t;
}

export default function DecimalInput({
  value,
  onChangeNumber,
  maxDecimals = 2,
  onBlur,
  ...rest
}: DecimalInputProps) {
  const [text, setText] = useState<string>(
    value == null ? '' : String(value),
  );
  // Track whether the input is focused so we skip external-sync while user types
  const focusedRef = useRef(false);

  // External sync: when value changes and doesn't match current text's parse, update text.
  // Invariant: text '' with value 0 is considered in sync — never rewrite to "0".
  useEffect(() => {
    const parsed = parse(text);
    // In sync: parsed equals value, or (text '' and value is 0/null/undefined)
    const textIsEmpty = text === '' || text === '.';
    const valueIsZeroish = value == null || value === 0;
    if (textIsEmpty && valueIsZeroish) return;
    if (parsed === value) return;
    // Skip if focused AND only a trailing '.' differs (user is mid-entry "1." → value=1)
    if (focusedRef.current && text.endsWith('.') && parse(text.replace(/\.$/, '')) === value) return;
    setText(value == null ? '' : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleChangeText(raw: string) {
    // Normalise: commas to dots, strip non-digit/dot chars
    let s = raw.replace(',', '.').replace(/[^0-9.]/g, '');
    // Only one dot allowed
    const firstDot = s.indexOf('.');
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
    }
    // Enforce maxDecimals
    const dotPos = s.indexOf('.');
    if (dotPos !== -1 && s.length - dotPos - 1 > maxDecimals) {
      s = s.slice(0, dotPos + maxDecimals + 1);
    }
    setText(s);
    onChangeNumber(parse(s));
  }

  function handleBlur(e: any) {
    // Normalise display on blur
    setText((prev) => {
      const norm = normalise(prev);
      // If value changed due to normalise, sync parent (shouldn't normally differ, but be safe)
      const p = parse(norm);
      if (p !== parse(prev)) onChangeNumber(p);
      return norm;
    });
    focusedRef.current = false;
    onBlur?.(e);
  }

  function handleFocus() {
    focusedRef.current = true;
  }

  return (
    <TextInput
      {...rest}
      value={text}
      onChangeText={handleChangeText}
      onBlur={handleBlur}
      onFocus={handleFocus}
      // decimal-pad on iOS gives a decimal key; numeric on Android also has one
      keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
    />
  );
}
