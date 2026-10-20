#!/bin/bash
# Stands in for: python -u -m scope KEY [--build-pack DIR | --run --story-pack FILE]   (so $1..$3 are -u -m scope, $4 the key)
key="$4"; shift 4
if [ "$1" = "--build-pack" ] && [ -n "$FAKE_RELPACK" ]; then
  mkdir -p rel; echo "{\"schema_version\":1,\"key\":\"$key\"}" > rel/pack.json; echo "pack: rel/pack.json"; exit 0
fi
if [ "$1" = "--build-pack" ]; then
  mkdir -p "$2"; echo "{\"schema_version\":1,\"key\":\"$key\"}" > "$2/pack.json"; echo "pack: $2/pack.json"; exit 0
fi
case "${FAKE_MODE:-ok}" in
  exit2) echo "boom: engine failed" >&2; exit 2 ;;
  slow) echo $$ > "$FAKE_PIDFILE"; sleep 30 ;;
  badversion) out="$(dirname "$FAKE_RESULT")/bad-result.json"; sed 's/"schema_version": *1/"schema_version": 2/' "$FAKE_RESULT" > "$out"; echo "result: $out" ;;
  errorresult) out="$(dirname "$FAKE_RESULT")/error-result.json"; sed 's/"schema_version": *1,/"schema_version": 1, "error": "RuntimeError: drivers agent returned no JSON",/' "$FAKE_RESULT" > "$out"; echo "result: $out" ;;
  noversion) out="$(dirname "$FAKE_RESULT")/no-version.json"; sed '/"schema_version"/d' "$FAKE_RESULT" > "$out"; echo "result: $out" ;;
  *) echo "result: $FAKE_RESULT" ;;
esac
