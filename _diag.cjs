const fs = require('fs');
const c = fs.readFileSync('js/ui/charges.js', 'utf8');
const needle = '${perUserSection}';
const i = c.indexOf(needle);
console.log('at', i);
if (i >= 0) console.log(JSON.stringify(c.slice(i, i + 200)));
