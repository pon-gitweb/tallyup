const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// Disable inlineRequires — causes Property 'X' doesn't exist with Hermes on RN 0.79
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: false,
    },
  }),
};

module.exports = config;
