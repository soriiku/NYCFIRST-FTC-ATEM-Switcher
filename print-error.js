const fs = require('fs');
const content = fs.readFileSync('build-error.log', 'utf16le');
const lines = content.split('\n');
console.log(lines.slice(-30).join('\n'));
