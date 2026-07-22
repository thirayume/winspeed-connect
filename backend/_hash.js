const bcrypt = require('bcrypt');

async function run() {
  const hash = await bcrypt.hash('W0rldF3rt', 10);
  console.log(hash);
}
run();
