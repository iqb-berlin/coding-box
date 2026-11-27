#!/usr/bin/env bash
set -euo pipefail

: "${BACKEND_IMAGE:?Set BACKEND_IMAGE to the production image under test}"
docker run --rm --entrypoint node "$BACKEND_IMAGE" --version
docker run --rm --entrypoint node "$BACKEND_IMAGE" -e '
  const assert = require("node:assert/strict");
  for (const name of ["@nestjs/core", "@nestjs/common", "@nestjs/platform-express",
    "@nestjs/typeorm", "@nestjs/bullmq", "@nestjs-modules/ioredis", "pg"]) require(name);
  assert.equal(require("libxmljs2").parseXml("<runtime/>").root().name(), "runtime");
  assert.ok(require("sqlite3").Database);
  console.log("Linux production dependencies loaded successfully");
'
if timeout 60 docker run --rm -e APP_ROLE=api -e JWT_SECRET= "$BACKEND_IMAGE" > container-startup.log 2>&1; then
  echo 'Invalid production configuration unexpectedly started.' >&2
  exit 1
fi
cat container-startup.log
grep -F 'JWT_SECRET must be a non-empty string' container-startup.log
sh scripts/qa/verify-backend-container.sh
