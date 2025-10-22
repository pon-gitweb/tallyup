/** Expo SDK 53 compatible Jest config */
module.exports = {
  preset: 'jest-expo',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(test|spec).[tj]s?(x)',
    '<rootDir>/src/**/?(*.)+(test|spec).[tj]s?(x)',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native'
      + '|@react-native(-community)?'
      + '|react-clone-referenced-element'
      + '|react-native-svg'
      + '|expo(nent)?'
      + '|expo-.*'
      + '|@expo/.*'
      + '|@unimodules/.*'
      + '|unimodules-.*'
      + '|sentry-expo'
      + '|native-base'
      + ')/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/'],
};
