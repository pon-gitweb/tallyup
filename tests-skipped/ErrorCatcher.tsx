import React from 'react';
import { render, screen } from '@testing-library/react-native';

test('renders fallback when child throws', () => {
  const { withErrorBoundary, PATCH1_ERROR_BOUNDARY_ENABLED } = require('../src/components/ErrorCatcher');
  expect(PATCH1_ERROR_BOUNDARY_ENABLED).toBe(true);
  const Boom = () => { throw new Error('boom'); };
  const Wrapped = withErrorBoundary(Boom as any, 'TestScreen');
  render(<Wrapped />);
  expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
  expect(screen.getByText(/TestScreen couldn’t load/i)).toBeTruthy();
  expect(screen.getByText(/Retry/i)).toBeTruthy();
});
