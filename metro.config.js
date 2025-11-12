const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const config = getDefaultConfig(__dirname);
// Never bundle server-only code
config.resolver.blockList = exclusionList([
  /\/server\/.*/,
  /\/functions\/.*/,
]);

module.exports = config;
