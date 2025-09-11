/** Expo SDK 53 compatible Jest config (no runtime changes) */
module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(test|spec).[tj]s?(x)',
    '<rootDir>/src/**/?(*.)+(test|spec).[tj]s?(x)',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-clone-referenced-element|@expo(nent)?/.*|expo(nent)?|@expo-google-fonts/.*|expo-font|expo-asset)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
  // keep it lean; we don’t need setupFilesAfterEnv for pure util tests
};
