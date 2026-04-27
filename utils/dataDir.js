const path = require('path');
module.exports = process.env.DATA_DIR || path.join(__dirname, '..');
