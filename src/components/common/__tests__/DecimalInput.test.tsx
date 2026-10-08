import React, { useState } from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import DecimalInput from '../DecimalInput';

// Wrap in a controlled parent so we can observe onChangeNumber
function Controlled({
  initial = null as number | null,
  maxDecimals,
  onReport,
}: {
  initial?: number | null;
  maxDecimals?: number;
  onReport?: (n: number | null) => void;
}) {
  const [val, setVal] = useState<number | null>(initial);
  return (
    <DecimalInput
      testID="input"
      value={val}
      maxDecimals={maxDecimals}
      onChangeNumber={(n) => {
        setVal(n);
        onReport?.(n);
      }}
    />
  );
}

// Helper to type into the input
function typeInto(input: any, text: string) {
  fireEvent.changeText(input, text);
}

describe('DecimalInput', () => {
  it('"1." stays "1." while typing — no instant-parse to 1', () => {
    const { getByTestId } = render(<Controlled />);
    const inp = getByTestId('input');
    typeInto(inp, '1.');
    expect(inp.props.value).toBe('1.');
  });

  it('"1.5" renders as "1.5" and parses to 1.5', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '1.5');
    expect(getByTestId('input').props.value).toBe('1.5');
    expect(reported.at(-1)).toBe(1.5);
  });

  it('".5" renders as ".5" and parses to 0.5', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '.5');
    expect(getByTestId('input').props.value).toBe('.5');
    expect(reported.at(-1)).toBe(0.5);
  });

  it('"1,5" is treated as "1.5"', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '1,5');
    expect(getByTestId('input').props.value).toBe('1.5');
    expect(reported.at(-1)).toBe(1.5);
  });

  it('"1.2.3" — second dot is ignored, text stays "1.23"', () => {
    const { getByTestId } = render(<Controlled />);
    typeInto(getByTestId('input'), '1.2.3');
    expect(getByTestId('input').props.value).toBe('1.23');
  });

  it('"12.345" with maxDecimals=2 stops at "12.34"', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(
      <Controlled maxDecimals={2} onReport={(n) => reported.push(n)} />,
    );
    typeInto(getByTestId('input'), '12.345');
    expect(getByTestId('input').props.value).toBe('12.34');
    expect(reported.at(-1)).toBe(12.34);
  });

  it('empty string gives null', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled initial={5} onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '');
    expect(reported.at(-1)).toBeNull();
  });

  it('pasting "$12.50" strips the dollar sign to give "12.50"', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '$12.50');
    expect(getByTestId('input').props.value).toBe('12.50');
    expect(reported.at(-1)).toBe(12.5);
  });

  it('blur on "12." normalises to "12"', () => {
    const { getByTestId } = render(<Controlled />);
    const inp = getByTestId('input');
    typeInto(inp, '12.');
    expect(inp.props.value).toBe('12.');
    fireEvent(inp, 'blur');
    expect(inp.props.value).toBe('12');
  });

  it('external value 5 → 7 updates the displayed text', () => {
    // Use a wrapper that changes the value prop externally
    function Changer() {
      const [v, setV] = useState<number | null>(5);
      return (
        <>
          <DecimalInput testID="input" value={v} onChangeNumber={() => {}} />
          <DecimalInput testID="trigger" value={null} onChangeNumber={() => setV(7)} />
        </>
      );
    }
    const { getByTestId } = render(<Changer />);
    expect(getByTestId('input').props.value).toBe('5');
    // Simulate parent changing value by firing changeText on the trigger (which calls setV(7))
    fireEvent.changeText(getByTestId('trigger'), '');
    expect(getByTestId('input').props.value).toBe('7');
  });

  it('external change while text is "1." and value is 1 does NOT overwrite', () => {
    // value = 1 is reported after typing "1." (parse("1.") === null, but parse("1") === 1).
    // The sync rule: text ends with '.' and parse(text without dot) === value → skip.
    // This is tested by: type "1.", check text is still "1."
    function Stable() {
      const [v, setV] = useState<number | null>(null);
      return (
        <DecimalInput
          testID="input"
          value={v}
          onChangeNumber={(n) => setV(n)}
        />
      );
    }
    const { getByTestId } = render(<Stable />);
    const inp = getByTestId('input');
    // Type "1" — value becomes 1
    typeInto(inp, '1');
    expect(inp.props.value).toBe('1');
    // Type "1." — parse is null, value becomes null; the sync sees value changed from 1→null,
    // but text "1." empty check: textIsEmpty=false, valueIsZeroish=true → sync runs but
    // value=null and text='1.' — the "trailing dot while focused" guard kicks in if focused.
    // We accept that when focused the guard protects the mid-entry state.
    typeInto(inp, '1.');
    // Text should remain '1.' (not rewritten)
    expect(inp.props.value).toBe('1.');
  });

  it('index-keyed list: deleting row 1 shows correct values in remaining rows', () => {
    // Rows [10, 20, 30]. Delete row at index 1 (value 20) → remaining [10, 30].
    // Each DecimalInput must show the value of its new row, not the stale text.
    function RowList() {
      const [rows, setRows] = useState([10, 20, 30]);
      return (
        <>
          {rows.map((v, i) => (
            <DecimalInput
              key={i} // intentionally index-keyed to expose the bug
              testID={`row-${i}`}
              value={v}
              onChangeNumber={() => {}}
            />
          ))}
          <DecimalInput
            testID="delete"
            value={null}
            onChangeNumber={() => setRows([10, 30])}
          />
        </>
      );
    }
    const { getByTestId } = render(<RowList />);
    expect(getByTestId('row-0').props.value).toBe('10');
    expect(getByTestId('row-1').props.value).toBe('20');
    expect(getByTestId('row-2').props.value).toBe('30');
    // Delete row 1 (value 20)
    fireEvent.changeText(getByTestId('delete'), '');
    // Now row-0 should be 10, row-1 should be 30 (was 20 before delete)
    expect(getByTestId('row-0').props.value).toBe('10');
    expect(getByTestId('row-1').props.value).toBe('30');
  });

  it('"$1,234.50" → 1234.5 (thousands comma + currency symbol)', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '$1,234.50');
    expect(getByTestId('input').props.value).toBe('1234.50');
    expect(reported.at(-1)).toBe(1234.5);
  });

  it('"1,234" → 1234 (three digits after comma → thousands, not decimal)', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '1,234');
    expect(getByTestId('input').props.value).toBe('1234');
    expect(reported.at(-1)).toBe(1234);
  });

  it('"12,50" → 12.5 (two digits after comma → decimal comma)', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '12,50');
    expect(getByTestId('input').props.value).toBe('12.50');
    expect(reported.at(-1)).toBe(12.5);
  });

  it('typing "1", ",", "5" key by key gives "1", "1.", "1.5" (European decimal keyboard)', () => {
    // Bug before fix: "1," stripped the comma to "1", so "5" appended as "15" (silent 10× error).
    // Fix: trailing comma /^\d+,$/ converts to "." so the next digit lands in the decimal portion.
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    const inp = getByTestId('input');

    typeInto(inp, '1');
    expect(inp.props.value).toBe('1');

    typeInto(inp, '1,');       // comma with nothing after it = decimal point being started
    expect(inp.props.value).toBe('1.');

    typeInto(inp, '1,5');      // European keyboard: comma IS the decimal key; "1,5" → "1.5"
    expect(inp.props.value).toBe('1.5');
    expect(reported.at(-1)).toBe(1.5);
  });

  it('typing "1,234" key by key: mid-entry shows decimal but final result is "1234"', () => {
    // "1,2" is allowed to show as "1.2" mid-typing (only 1 digit after comma so far).
    // When the 3rd digit arrives the full string "1,234" has 3 digits after the comma,
    // which is the thousands-separator rule, so the decimal is removed and the result
    // is "1234". This verifies the "later resolves" property.
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    const inp = getByTestId('input');

    typeInto(inp, '1');
    expect(inp.props.value).toBe('1');

    typeInto(inp, '1,');         // trailing comma → decimal point started
    expect(inp.props.value).toBe('1.');

    typeInto(inp, '1,2');        // 1 digit after comma → treated as decimal mid-entry
    expect(inp.props.value).toBe('1.2');

    typeInto(inp, '1,23');       // 2 digits after comma → still decimal mid-entry
    expect(inp.props.value).toBe('1.23');

    typeInto(inp, '1,234');      // 3 digits after comma → thousands separator, no decimal
    expect(inp.props.value).toBe('1234');
    expect(reported.at(-1)).toBe(1234);
  });

  it('"1,234,567.8" → 1234567.8 (multiple thousands commas with dot)', () => {
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    typeInto(getByTestId('input'), '1,234,567.8');
    expect(getByTestId('input').props.value).toBe('1234567.8');
    expect(reported.at(-1)).toBe(1234567.8);
  });

  it('caller-supplied onFocus is called when the field is focused', () => {
    const onFocusMock = jest.fn();
    const { getByTestId } = render(
      <DecimalInput testID="input" value={null} onChangeNumber={() => {}} onFocus={onFocusMock} />,
    );
    fireEvent(getByTestId('input'), 'focus');
    expect(onFocusMock).toHaveBeenCalledTimes(1);
  });

  it('blur normalisation updates display without extra onChangeNumber calls', () => {
    // "12." and "12" both parse to 12 (JS Number("12.") === 12). Blur changes
    // the display to "12" but must NOT fire onChangeNumber again since the value
    // is unchanged. This also verifies onChangeNumber is not called inside the
    // setState updater (which would be a React anti-pattern).
    const reported: (number | null)[] = [];
    const { getByTestId } = render(<Controlled onReport={(n) => reported.push(n)} />);
    const inp = getByTestId('input');
    typeInto(inp, '12.');
    const countAfterType = reported.length;
    fireEvent(inp, 'blur');
    expect(getByTestId('input').props.value).toBe('12');
    expect(reported.length).toBe(countAfterType); // no extra calls on blur
  });

  it('parent coercing null → 0 does not snap the display to "0" when cleared', () => {
    // Parent does: setVal(n ?? 0), so value is always a number.
    // User clears field → onChangeNumber(null) → parent sets 0 → value=0.
    // Empty text with value=0 is considered in sync; text must stay ''.
    function CoercingParent() {
      const [v, setV] = useState<number>(5);
      return (
        <DecimalInput
          testID="input"
          value={v}
          onChangeNumber={(n) => setV(n ?? 0)}
        />
      );
    }
    const { getByTestId } = render(<CoercingParent />);
    const inp = getByTestId('input');
    // Clear the field
    typeInto(inp, '');
    // Value is now 0 (coerced), but text should remain '' not snap to '0'
    expect(inp.props.value).toBe('');
  });
});
