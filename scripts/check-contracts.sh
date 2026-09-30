#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 - <<'PY'
import json
from pathlib import Path

checked = 0
failures = []
for path in Path("contracts/evm/out").glob("*/*.json"):
    artifact = json.loads(path.read_text())
    metadata = artifact.get("metadata") or json.loads(artifact.get("rawMetadata") or "{}")
    if isinstance(metadata, str):
        metadata = json.loads(metadata)
    for source, name in metadata.get("settings", {}).get("compilationTarget", {}).items():
        if not source.startswith("src/"):
            continue
        runtime = len(artifact.get("deployedBytecode", {}).get("object", "").removeprefix("0x")) // 2
        creation = len(artifact.get("bytecode", {}).get("object", "").removeprefix("0x")) // 2
        if runtime == 0:
            continue
        monad = source.startswith("src/monad/")
        maximum_runtime, maximum_creation = (131072, 262144) if monad else (24576, 49152)
        checked += 1
        if runtime > maximum_runtime or creation > maximum_creation:
            failures.append(f"{source}:{name}: runtime {runtime}/{maximum_runtime}, initcode {creation}/{maximum_creation}")
if not checked:
    raise SystemExit("No compiled contracts found; run forge build first")
if failures:
    raise SystemExit("\n".join(failures))
print(f"Contract bytecode limits passed: {checked} production artifacts")
PY
