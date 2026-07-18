const bcrypt = require('bcrypt');
async function run() {
  const hash = await bcrypt.hash('***REMOVED-PASSWORD***', 12);
  console.log('HASH: ' + hash);
}
run();
