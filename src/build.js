'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const productionIndex = 'public/index.html';
const expectedSha256 = 'f81fdd0755653dd6a4be3a64d26e18779ecfce266f8e6006426ee28fcf9d7080';
const requiredFiles = [
  'public/index.html',
  'public/read/index.html',
  'public/stories/index.html',
  'public/B1_level3/index.html',
  'public/grammar-level6/index.html',
  'public/arabic-academy/index.html',
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`Required production file is missing: ${file}`);
}

const index = fs.readFileSync(productionIndex);
const actualSha256 = crypto.createHash('sha256').update(index).digest('hex');
if (actualSha256 !== expectedSha256) {
  throw new Error(`Production index checksum mismatch: ${actualSha256}`);
}

console.log(`Verified production snapshot: ${productionIndex} (${index.length} bytes, SHA-256 ${actualSha256}); static output is public/.`);
