import React, { useState } from 'react';
import { Text, Button } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { jest } from '@jest/globals';
jest.useFakeTimers();

test('updates only after delay', () => {
  const { useDebouncedValue } = require('../src/utils/useDebouncedValue');
  const Probe = () => {
    const [v, setV] = useState('a');
    const dv = useDebouncedValue(v, 200);
    return (<>
      <Text testID="dv">{dv}</Text>
      <Button title="b" onPress={() => setV('b')} />
    </>);
  };
  render(<Probe />);
  expect(screen.getByTestId('dv').props.children).toBe('a');
  screen.getByText('b').props.onPress();
  expect(screen.getByTestId('dv').props.children).toBe('a');
  jest.advanceTimersByTime(199);
  expect(screen.getByTestId('dv').props.children).toBe('a');
  jest.advanceTimersByTime(1);
  expect(screen.getByTestId('dv').props.children).toBe('b');
});
