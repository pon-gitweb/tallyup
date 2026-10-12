#!/usr/bin/env node
/**
 * Static check: for each (collection, appFile) entry, verify that every
 * top-level key the app writes in addDoc is allowed by the Firestore security
 * rules hasOnlyFields() list for that collection's CREATE rule.
 *
 * Uses the TypeScript compiler API (ts.createSourceFile) to walk the AST, so
 * keys placed AFTER a nested object literal are correctly detected.
 *
 * Exits 1 if:
 *   - any written key is not in the rules' allowed list
 *   - a spread element or computed key appears in the addDoc payload
 *   - the rules file or any app file cannot be read
 *   - no addDoc call for the expected collection is found
 */

const ts   = require('typescript');
const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Parse a TypeScript/TSX source string and return, for every
 *   addDoc(collection(..., '<collectionName>'), { ... })
 * call found, an object describing the top-level keys of the payload:
 *
 *   { keys: string[], error: string | null }
 *
 * `error` is non-null when the payload contains a spread element or a
 * computed property name (neither can be checked statically).
 */
function extractAddDocKeysFromSource(src, collectionName, scriptKind) {
  const sk = scriptKind ?? ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    'check.ts', src, ts.ScriptTarget.Latest, /* setParentNodes */ true, sk
  );

  const results = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'addDoc' &&
      node.arguments.length >= 2
    ) {
      const firstArgText = node.arguments[0].getText(sourceFile);
      if (
        firstArgText.includes(`'${collectionName}'`) ||
        firstArgText.includes(`"${collectionName}"`)
      ) {
        const secondArg = node.arguments[1];
        if (ts.isObjectLiteralExpression(secondArg)) {
          const keys  = [];
          let   error = null;

          for (const prop of secondArg.properties) {
            if (ts.isSpreadAssignment(prop)) {
              error = `spread element (...) in addDoc payload — cannot statically verify all keys`;
              break;
            }
            const name = prop.name;
            if (!name) {
              error = `anonymous property in addDoc payload`;
              break;
            }
            if (ts.isComputedPropertyName(name)) {
              error = `computed property [${name.getText(sourceFile)}] in addDoc payload — cannot statically verify`;
              break;
            }
            if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
              keys.push(name.text);
            }
          }

          results.push({ keys, error });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

/**
 * Extract the hasOnlyFields allowed-key list from the named collection's
 * CREATE block in firestore.rules.
 * Returns null if the block or list cannot be found.
 */
function extractRulesKeys(rulesText, collectionPath) {
  const block = rulesText.match(
    new RegExp(
      `match\\s+\\/${collectionPath}\\/\\{[^}]+\\}[^}]*?allow\\s+create[^;]+;`,
      's'
    )
  );
  if (!block) return null;
  const listMatch = block[0].match(
    /hasOnlyFields\s*\(\s*request\.resource\.data\s*,\s*\[([^\]]+)\]/
  );
  if (!listMatch) return null;
  return listMatch[1]
    .split(',')
    .map(s => s.replace(/['"'\s]/g, ''))
    .filter(Boolean);
}

// ── Entries to check ──────────────────────────────────────────────────────────

const CHECKS = [
  {
    collection: 'salesReports',
    collectionPath: 'salesReports',
    appFiles: [
      { path: 'src/services/sales/storeSalesReport.ts', scriptKind: ts.ScriptKind.TS  },
      { path: 'web-app/src/pages/ImportPage.tsx',        scriptKind: ts.ScriptKind.TSX },
    ],
    rulesFile: 'firestore.rules',
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

function main() {
  let failed = false;

  for (const check of CHECKS) {
    const rulesText   = fs.readFileSync(path.join(ROOT, check.rulesFile), 'utf8');
    const allowedKeys = extractRulesKeys(rulesText, check.collectionPath);

    if (!allowedKeys || allowedKeys.length === 0) {
      console.error(
        `check:rules-payloads FAIL  Could not extract hasOnlyFields list for ` +
        `${check.collection} from ${check.rulesFile}`
      );
      failed = true;
      continue;
    }

    const allowedSet = new Set(allowedKeys);

    for (const appFile of check.appFiles) {
      const src     = fs.readFileSync(path.join(ROOT, appFile.path), 'utf8');
      const results = extractAddDocKeysFromSource(src, check.collectionPath, appFile.scriptKind);

      if (results.length === 0) {
        console.error(
          `check:rules-payloads FAIL  No addDoc call for '${check.collection}' found in ${appFile.path}`
        );
        failed = true;
        continue;
      }

      for (const result of results) {
        if (result.error) {
          console.error(`check:rules-payloads FAIL  ${appFile.path}: ${result.error}`);
          failed = true;
          continue;
        }

        const violations = result.keys.filter(k => !allowedSet.has(k));
        if (violations.length > 0) {
          console.error(
            `check:rules-payloads FAIL  ${appFile.path} writes top-level key(s) not in ` +
            `${check.collection} CREATE rule: ${violations.join(', ')}`
          );
          console.error(`  Allowed: ${[...allowedSet].join(', ')}`);
          console.error(`  Written: ${result.keys.join(', ')}`);
          failed = true;
        } else {
          console.log(
            `check:rules-payloads ✓  ${appFile.path} (${check.collection}) — ` +
            `keys: ${result.keys.join(', ')}`
          );
        }
      }
    }
  }

  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { extractAddDocKeysFromSource, extractRulesKeys };
