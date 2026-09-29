'use strict';
const fs = require('node:fs');
// Exclusive creation retains interrupted intents for inspection, never overwrite.
function writeExclusive(file, value) {
  const bytes = JSON.stringify(value);
  const fd = fs.openSync(file, 'wx');
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
module.exports = {writeExclusive};
