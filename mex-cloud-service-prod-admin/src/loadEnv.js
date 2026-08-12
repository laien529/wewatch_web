const fs = require('fs');
const path = require('path');

function loadLocalEnv() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) return;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
}

module.exports = { loadLocalEnv };
