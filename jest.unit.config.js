/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  modulePathIgnorePatterns: [
    '<rootDir>/functions',
    '<rootDir>/backend/functions'
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(expo|react-native|@react-native|@react-navigation|expo-modules-core|@expo|react-native-reanimated|react-native-gesture-handler|react-native-safe-area-context)/)'
  ],
  moduleNameMapper: {
    '^expo/virtual/env$': '<rootDir>/test/mocks/expo-virtual-env.js'
  },
  setupFiles: [
    '<rootDir>/test/jest.setup.js'
  ]
};
