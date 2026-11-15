#!/usr/bin/env sh
set -eu
node src/build.js
node cloudflare/generate-config.mjs
node --test cloudflare/tests/worker.test.mjs
