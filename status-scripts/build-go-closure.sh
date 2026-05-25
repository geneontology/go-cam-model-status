#!/usr/bin/env bash
# Build the rdfs:subClassOf* closure used by the GO-CAM ShEx check.
#
# Input is an ontology (typically the riot merge of go-lego, neo, and reacto;
# see the workflow's "Merge ontologies" step) loaded by Apache Jena arq.
#
# Recent JDKs enforce very small XML entity expansion limits by default. The
# OWL/XML form of go-lego.owl exceeds those limits, so keep the required JAXP
# overrides in one place instead of requiring every local or CI caller to
# remember them.

set -euo pipefail

REPO="$(cd "$(dirname "$0")"/.. && pwd)"
ARQ="${ARQ_CMD:-arq}"
INPUT=""
OUTPUT=""
QUERY="$REPO/sparql/closures/go-subclassof-closure.rq"
MAX_HEAP="${GO_CLOSURE_MAX_HEAP:-4G}"

usage() {
  cat >&2 <<'EOF'
Usage: status-scripts/build-go-closure.sh --input <owl> --output <ttl>

Options:
  --input <rdf>     Path to the merged ontology (go-lego + neo + reacto).
  --output <ttl>    Where to write the materialised closure TTL. Use - for stdout.
  --query <rq>      Closure CONSTRUCT query (default: sparql/closures/go-subclassof-closure.rq).
  --arq <cmd>       Apache Jena arq command (default: arq, or ARQ_CMD env).
  --max-heap <size> JVM heap for arq (default: 4G, or GO_CLOSURE_MAX_HEAP env).
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input)
      INPUT="$2"
      shift 2
      ;;
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --query)
      QUERY="$2"
      shift 2
      ;;
    --arq)
      ARQ="$2"
      shift 2
      ;;
    --max-heap)
      MAX_HEAP="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$INPUT" ]]; then
  echo "Missing --input" >&2
  usage
  exit 2
fi
if [[ -z "$OUTPUT" ]]; then
  echo "Missing --output" >&2
  usage
  exit 2
fi
if [[ ! -f "$INPUT" ]]; then
  echo "Input ontology not found: $INPUT" >&2
  exit 2
fi
if [[ ! -f "$QUERY" ]]; then
  echo "Closure query not found: $QUERY" >&2
  exit 2
fi

DEFAULT_JVM_ARGS=(
  "-Xmx${MAX_HEAP}"
  "-Djdk.xml.maxGeneralEntitySizeLimit=0"
  "-Djdk.xml.totalEntitySizeLimit=0"
)

# Put caller-supplied JVM_ARGS last so an explicit local override still wins.
export JVM_ARGS="${DEFAULT_JVM_ARGS[*]} ${JVM_ARGS:-}"

if [[ "$OUTPUT" == "-" ]]; then
  "$ARQ" --data "$INPUT" --query "$QUERY"
else
  mkdir -p "$(dirname "$OUTPUT")"
  "$ARQ" --data "$INPUT" --query "$QUERY" > "$OUTPUT"
fi
