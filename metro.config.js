const path = require('path');
const { getDefaultConfig } = require('expo/metro-config'); // <- works with Expo CLI
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Keep Node/backend code out of the RN bundle
config.resolver.blockList = exclusionList([
  new RegExp(`${path.sep}functions${path.sep}.*`),
  new RegExp(`${path.sep}server${path.sep}.*`),
]);

module.exports = config;
