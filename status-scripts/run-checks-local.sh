#!/usr/bin/env bash
# Run the full status pipeline locally — useful for the initial corpus backfill
# from the user's laptop, or for debugging the workflow without pushing.
#
# Requires:
#   - Node.js 20+
#   - Docker, for three images:
#       balhoff/materializer:latest        (override: MATERIALIZER_CMD)
#       ghcr.io/balhoff/jena-batch:v0.6.0  (override: JENA_BATCH_CMD)
#       obolibrary/robot:latest            (for the closure-source merge)
#   - go-lego.owl on disk (--go-lego) for the materializer OWL-consistency check
#   - rdfs:subClassOf* closure TTL on disk (--go-closure) for the GO-CAM ShEx
#     check. Build it from the ROBOT merge of go-lego + neo + reacto:
#       wget -O /tmp/go-lego.owl http://purl.obolibrary.org/obo/go/extensions/go-lego.owl
#       wget -O /tmp/neo.owl     http://purl.obolibrary.org/obo/go/noctua/neo.owl
#       wget -O /tmp/reacto.owl  http://purl.obolibrary.org/obo/go/extensions/reacto.owl
#       docker run --rm -v /tmp:/work obolibrary/robot:latest \
#         robot merge --input /work/go-lego.owl --input /work/neo.owl --input /work/reacto.owl \
#                     --output /work/closure-source.owl
#       bash status-scripts/build-go-closure.sh \
#           --input /tmp/closure-source.owl \
#           --output /tmp/go-closure.ttl
#     The closure only changes when the source ontologies change, so cache it.
#
# Examples:
#   # A single model (debug)
#   bash status-scripts/run-checks-local.sh \
#       --go-lego /tmp/go-lego.owl \
#       --go-closure /tmp/go-closure.ttl \
#       --output /tmp/single.json \
#       models/abc.ttl
#
#   # Full corpus from a file list (recommended; avoids ARG_MAX overflow that
#   # bites at ~50K+ models when using shell globbing).
#   find models -maxdepth 1 -name '*.ttl' | sort > /tmp/models.txt
#   bash status-scripts/run-checks-local.sh \
#       --go-lego /tmp/go-lego.owl \
#       --go-closure /tmp/go-closure.ttl \
#       --models-file /tmp/models.txt \
#       --output /tmp/run.json
#
#   # Then merge into a worktree of the status-data branch:
#   git worktree add ../noctua-models-status-data status-data
#   node status-scripts/update-status.mjs \
#       --data-dir ../noctua-models-status-data \
#       --run /tmp/run.json \
#       --master-sha "$(git rev-parse HEAD)"

set -euo pipefail

REPO="$(cd "$(dirname "$0")"/.. && pwd)"
GO_LEGO=""
GO_CLOSURE=""
OUTPUT="-"
MODELS_FILE=""
MODELS=()
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --go-lego)
      GO_LEGO="$2"
      shift 2
      ;;
    --go-closure)
      GO_CLOSURE="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --models-file)
      MODELS_FILE="$2"
      shift 2
      ;;
    --skip-owl|--skip-shex)
      EXTRA_ARGS+=("$1")
      shift
      ;;
    --materializer|--max-heap|--keep-materialized|--materializer-timeout-ms|--jena-batch|--jena-batch-max-heap|--jena-batch-parallelism|--jena-batch-timeout-ms)
      EXTRA_ARGS+=("$1" "$2")
      shift 2
      ;;
    --)
      shift
      MODELS+=("$@")
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
    *)
      MODELS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$MODELS_FILE" && ${#MODELS[@]} -eq 0 ]]; then
  echo "No models supplied. Pass either --models-file <path> or one or more model.ttl arguments." >&2
  echo "Usage: $0 --go-lego <path> --output <json> [--models-file <path> | model.ttl ...]" >&2
  exit 2
fi

if [[ -z "$GO_LEGO" ]]; then
  echo "Missing --go-lego" >&2
  exit 2
fi

# --go-closure is required unless --skip-shex was passed. Mirror run-checks.mjs's
# own validation here so the user gets the failure before the script forks node.
SKIP_SHEX=0
for a in "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"; do
  if [[ "$a" == "--skip-shex" ]]; then
    SKIP_SHEX=1
  fi
done
if [[ -z "$GO_CLOSURE" && "$SKIP_SHEX" == "0" ]]; then
  echo "Missing --go-closure (required unless --skip-shex)." >&2
  echo "Build with: bash status-scripts/build-go-closure.sh \\" >&2
  echo "              --go-lego $GO_LEGO \\" >&2
  echo "              --output go-closure.ttl" >&2
  exit 2
fi
if [[ -n "$GO_CLOSURE" ]]; then
  EXTRA_ARGS+=("--go-closure" "$GO_CLOSURE")
fi

cd "$REPO"

# Prefer --models-file (no ARG_MAX risk). If positional models were given as
# well, write them into a temp file and combine. This keeps the actual exec
# call's argument list bounded regardless of corpus size.
if [[ -n "$MODELS_FILE" || ${#MODELS[@]} -gt 200 ]]; then
  TMP_LIST="$(mktemp)"
  trap 'rm -f "$TMP_LIST"' EXIT
  if [[ -n "$MODELS_FILE" ]]; then
    cat "$MODELS_FILE" >> "$TMP_LIST"
  fi
  if [[ ${#MODELS[@]} -gt 0 ]]; then
    printf '%s\n' "${MODELS[@]}" >> "$TMP_LIST"
  fi
  # Use ${arr[@]+"${arr[@]}"} idiom — bare ${arr[@]} trips `set -u` when the
  # array is empty (e.g. no --skip-* / --max-heap / --arq flags supplied).
  exec node status-scripts/run-checks.mjs \
    --repo "$REPO" \
    --go-lego "$GO_LEGO" \
    --output "$OUTPUT" \
    ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
    --models-file "$TMP_LIST"
else
  exec node status-scripts/run-checks.mjs \
    --repo "$REPO" \
    --go-lego "$GO_LEGO" \
    --output "$OUTPUT" \
    ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
    --models "${MODELS[@]}"
fi
