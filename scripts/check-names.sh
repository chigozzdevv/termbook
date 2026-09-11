#!/bin/sh
set -e
bad=$(find packages server -name "*.ts" | while read -r f; do
  base=$(basename "$f" .ts)
  base=${base%.test}
  words=$(echo "$base" | awk -F- '{print NF}')
  if [ "$words" -gt 2 ]; then echo "$f"; fi
done)
if [ -n "$bad" ]; then
  echo "names-over-two-words:"
  echo "$bad"
  exit 1
fi
echo "names-ok"
