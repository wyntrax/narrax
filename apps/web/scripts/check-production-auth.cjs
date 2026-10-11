/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node build check. */
const fs = require('node:fs');
const path = require('node:path');
const markers = /auth-fixture|fixture-public-test-token|__fixture-signature|Phantom \(test fixture\)|fixture signature approved/;
function checkProductionAuth(directory) {
  if (!fs.existsSync(path.join(directory, 'BUILD_ID'))) throw Error('Production BUILD_ID missing');
  let scanned = 0;
  function walk(dir) {
    for (const item of fs.readdirSync(dir, {withFileTypes: true})) {
      if (['cache', 'types'].includes(item.name)) continue;
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (/\.(?:js|json|html|map|rsc|txt)$/.test(item.name)) {
        scanned++;
        if (markers.test(fs.readFileSync(file, 'utf8'))) throw Error(`Fixture auth leaked into production: ${path.relative(directory, file)}`);
      }
    }
  }
  walk(directory);
  if (!scanned) throw Error('Production bundle is empty');
  return scanned;
}
module.exports = {checkProductionAuth};
if (require.main === module) console.log(`Production auth scan passed: ${checkProductionAuth(path.resolve(__dirname, '../.next'))} files`);
