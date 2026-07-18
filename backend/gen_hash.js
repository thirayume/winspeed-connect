const bcrypt = require('bcrypt');
async function run() {
  const hash = await bcrypt.hash('W0rldF3rt', 12);
  console.log('HASH: ' + hash);
}
run();
