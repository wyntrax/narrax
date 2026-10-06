// node scripts/check-test-results.mjs vitest-results.json
// Fails (exit 1) when any test failed OR was skipped. A skipped integration test means a database or Redis was not reachable,
// and a skip is not a pass.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'vitest-results.json';
const r = JSON.parse(readFileSync(file, 'utf8'));
const { numTotalTests: total, numPassedTests: passed, numFailedTests: failed, numPendingTests: skipped, numTodoTests: todo = 0 } = r;
console.log(`Tests: ${passed} passed, ${failed} failed, ${skipped} skipped, ${todo} todo, ${total} total.`);
// A test FILE that cannot load (a missing generated Prisma client, a bad import) reports zero tests, so counting tests alone would
// call it green. Count failed suites and any file that is not marked passed.
const badFiles = (r.testResults ?? []).filter((f) => f.status !== 'passed');
const failedSuites = r.numFailedTestSuites ?? 0;
console.log(`Files: ${(r.testResults ?? []).length} total, ${badFiles.length} not passed.`);
if (badFiles.length) console.error(`Not passed: ${badFiles.map((f) => f.name).join(', ')}`);
if (failedSuites > 0 || badFiles.length > 0 || failed > 0 || skipped > 0 || todo > 0 || passed !== total) {
  const skippedFiles = (r.testResults ?? []).filter((f) => (f.assertionResults ?? []).some((a) => a.status === 'pending' || a.status === 'skipped')).map((f) => f.name);
  if (skippedFiles.length) console.error(`Skipped in: ${skippedFiles.join(', ')}`);
  console.error('Not green: every test must run and pass.');
  process.exit(1);
}
