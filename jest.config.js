/**
 * Bridge so bare `npx jest` picks up the same config as `npm test`.
 * Keeps CI/dev muscle memory intact.
 */
module.exports = require('./jest.unit.config');
