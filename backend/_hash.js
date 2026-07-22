const bcrypt = require('bcrypt');

async function run() {
  const hash = await bcrypt.hash('***REMOVED-PASSWORD***', 10);
  console.log(hash);
}
run();
