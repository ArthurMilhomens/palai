#!/bin/sh
set -e

echo "Applying database schema..."
i=0
until ./node_modules/.bin/prisma db push --skip-generate; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Database is not ready after 30 attempts"
    exit 1
  fi
  echo "Retrying prisma db push ($i/30)..."
  sleep 2
done

echo "Starting Palai API..."
exec node dist/server.js
