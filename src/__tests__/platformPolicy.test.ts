/**
 * Unit tests for src/utils/platformPolicy.ts
 *
 * Platform.OS is set by jest-expo to 'ios' when running the iOS test suite.
 * We control it here by mocking react-native so we can test both branches.
 */

describe('canSelfRegister', () => {
  afterEach(() => jest.resetModules());

  it('is false on iOS', () => {
    jest.mock('react-native', () => ({
      Platform: { OS: 'ios' },
    }));
    const { canSelfRegister } = require('../utils/platformPolicy');
    expect(canSelfRegister).toBe(false);
  });

  it('is true on android', () => {
    jest.mock('react-native', () => ({
      Platform: { OS: 'android' },
    }));
    const { canSelfRegister } = require('../utils/platformPolicy');
    expect(canSelfRegister).toBe(true);
  });

  it('is true on web', () => {
    jest.mock('react-native', () => ({
      Platform: { OS: 'web' },
    }));
    const { canSelfRegister } = require('../utils/platformPolicy');
    expect(canSelfRegister).toBe(true);
  });
});
