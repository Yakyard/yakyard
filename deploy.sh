#!/bin/sh
# Same as `npm run deploy`. Kept for people used to ./deploy.sh.
cd "$(dirname "$0")" && exec node scripts/deploy.mjs
