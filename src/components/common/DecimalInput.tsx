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
  onFocus,
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
    // Strip everything except digits, dots, commas
    let s = raw.replace(/[^0-9.,]/g, '');

    // Comma handling:
    // - Has dot: remove all commas (they are thousands separators alongside a dot)
    // - Trailing comma /^\d+,$/: decimal separator being typed (e.g. "1," → "1.")
    //   so that typing "1" "," "5" on a European keyboard gives "1" "1." "1.5"
    //   rather than silently producing 15. Note: "1,2" may show "1.2" mid-entry
    //   while the user is still typing; if they continue to "1,234" it resolves
    //   back to "1234" via the 3-digit rule below.
    // - /^\d+,\d{1,2}$/: treat comma as decimal separator (e.g. "1,5" → "1.5")
    // - Otherwise (3+ digits after comma etc.): strip all commas (thousands separator)
    if (s.includes('.')) {
      s = s.replace(/,/g, '');
    } else if (/^\d+,$/.test(s)) {
      s = s.replace(',', '.');
    } else if (/^\d+,\d{1,2}$/.test(s)) {
      s = s.replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }

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
    // Compute normalised text and call parent outside the state updater
    const norm = normalise(text);
    setText(norm);
    const p = parse(norm);
    if (p !== parse(text)) onChangeNumber(p);
    focusedRef.current = false;
    onBlur?.(e);
  }

  function handleFocus(e: any) {
    focusedRef.current = true;
    onFocus?.(e);
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
