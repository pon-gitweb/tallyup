/**
 * Unit test config for Expo RN app.
 * - Transform ESM sources in node_modules (expo, @expo, expo-modules-core, RN stack)
 * - Ignore repair sandboxes & duplicate functions trees (haste collision)
 */
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js', '@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    // IMPORTANT: Do NOT ignore these packages so Babel can transform their ESM/TS
    'node_modules/(?!(expo|@expo|expo-modules-core|react-native|@react-native|@react-navigation|react-native-gesture-handler|react-native-reanimated|react-native-safe-area-context|react-native-screens)/)',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/\\.repair-',          // ignore stray repair suites at repo root
    '<rootDir>/functions/',          // avoid haste collision (tallyup-functions)
    '<rootDir>/backend/functions/',  // avoid haste collision
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/functions/',
    '<rootDir>/backend/functions/',
  ],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
};
