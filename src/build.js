'use strict';

const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.resolve('public');
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

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
if (!Array.isArray(vercel.rewrites)) {
  throw new Error('vercel.json must define a rewrites array.');
}

for (const [index, rule] of vercel.rewrites.entries()) {
  if (typeof rule.source !== 'string' || !rule.source.startsWith('/')) {
    throw new Error(`Invalid Vercel rewrite source at index ${index}.`);
  }
  if (typeof rule.destination !== 'string' || !rule.destination.startsWith('/')) {
    throw new Error(`Invalid Vercel rewrite destination at index ${index}.`);
  }

  const destinationPath = path.resolve(publicDir, `.${rule.destination}`);
  if (!destinationPath.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error(`Vercel rewrite destination escapes public/: ${rule.destination}`);
  }
  if (!fs.existsSync(destinationPath)) {
    throw new Error(`Vercel rewrite destination is missing: public${rule.destination}`);
  }
}

console.log(
  `Verified ${requiredFiles.length} required production pages and ${vercel.rewrites.length} Vercel rewrite destinations; static output is public/.`,
);
