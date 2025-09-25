/** Unit-only Jest config (no Expo/RN), runs fast with ts-jest */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { isolatedModules: true, tsconfig: 'tsconfig.jest.json' }]
  },
  testMatch: [
    '<rootDir>/src/utils/**/__tests__/**/*.(test|spec).[tj]s?(x)',
    '<rootDir>/src/utils/**/?(*.)+(test|spec).[tj]s?(x)'
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  transformIgnorePatterns: ['/node_modules/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/build/']
};
