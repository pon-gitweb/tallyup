/**
 * Wrapper jest config:
 * - Keeps your existing config in jest.unit.config.base.js
 * - Forces Jest to only discover tests from src/ and __tests__/
 * - Ensures _archive/ and backups/ are ignored for both tests and module resolution
 */
const base = require('./jest.unit.config.base');

const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

module.exports = {
  ...base,

  // Only look for tests in these folders (prevents _archive/ from being scanned)
  roots: ['<rootDir>/src', '<rootDir>/__tests__'],

  // Explicitly restrict test discovery to those roots
  testMatch: [
    '<rootDir>/src/**/?(*.)+(spec|test).[jt]s?(x)',
    '<rootDir>/__tests__/**/?(*.)+(spec|test).[jt]s?(x)',
  ],

  // Ensure archives/backups are ignored even if base config is broad
  testPathIgnorePatterns: uniq([
    ...(base.testPathIgnorePatterns || []),
    '/node_modules/',
    '/_archive/',
    '/backups/',
  ]),

  modulePathIgnorePatterns: uniq([
    ...(base.modulePathIgnorePatterns || []),
    '/_archive/',
    '/backups/',
  ]),
};
