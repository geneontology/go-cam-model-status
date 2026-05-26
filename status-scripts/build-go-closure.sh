#!/usr/bin/env bash
# Build the rdfs:subClassOf* closure used by the GO-CAM ShEx check.
#
# Input is an ontology (typically the riot merge of go-lego, neo, and reacto;
# see the workflow's "Merge ontologies" step). The merged dataset is too
# large for arq's in-memory model, so we go via TDB2: stream-load into a
# temporary on-disk store, then run the CONSTRUCT against it.
#
# Recent JDKs enforce very small XML entity expansion limits by default. The
# OWL/XML form of go-lego.owl exceeds those limits, so keep the required JAXP
# overrides in one place instead of requiring every local or CI caller to
# remember them. (No-op when input is Turtle.)

set -euo pipefail

REPO="$(cd "$(dirname "$0")"/.. && pwd)"
JENA_BIN="${JENA_BIN:-}"
INPUT=""
OUTPUT=""
QUERY="$REPO/sparql/closures/go-subclassof-closure.rq"
MAX_HEAP="${GO_CLOSURE_MAX_HEAP:-4G}"

usage() {
  cat >&2 <<'EOF'
Usage: status-scripts/build-go-closure.sh --input <rdf> --output <ttl>

Options:
  --input <rdf>     Path to the merged ontology (go-lego + neo + reacto).
  --output <ttl>    Where to write the materialised closure TTL. Use - for stdout.
  --query <rq>      Closure CONSTRUCT query (default: sparql/closures/go-subclassof-closure.rq).
  --jena-bin <dir>  Directory holding tdb2.tdbloader and tdb2.tdbquery
                    (default: dir of `arq` on PATH, or JENA_BIN env).
  --max-heap <size> JVM heap for tdb2 (default: 4G, or GO_CLOSURE_MAX_HEAP env).
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
    --jena-bin)
      JENA_BIN="$2"
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

if [[ -z "$JENA_BIN" ]]; then
  if command -v arq > /dev/null 2>&1; then
    JENA_BIN="$(dirname "$(command -v arq)")"
  else
    echo "Missing --jena-bin and no arq on PATH. Point --jena-bin at the Apache Jena CLI bin dir." >&2
    exit 2
  fi
fi
TDB_LOADER="$JENA_BIN/tdb2.tdbloader"
TDB_QUERY="$JENA_BIN/tdb2.tdbquery"
for tool in "$TDB_LOADER" "$TDB_QUERY"; do
  if [[ ! -x "$tool" ]]; then
    echo "Not executable: $tool" >&2
    exit 2
  fi
done

DEFAULT_JVM_ARGS=(
  "-Xmx${MAX_HEAP}"
  "-Djdk.xml.maxGeneralEntitySizeLimit=0"
  "-Djdk.xml.totalEntitySizeLimit=0"
)
# Put caller-supplied JVM_ARGS last so an explicit local override still wins.
export JVM_ARGS="${DEFAULT_JVM_ARGS[*]} ${JVM_ARGS:-}"

TDB_DIR="$(mktemp -d -t go-closure-tdb.XXXXXX)"
trap 'rm -rf "$TDB_DIR"' EXIT

# Load is streaming; the heap is for the CONSTRUCT step where the path
# `?sub rdfs:subClassOf* ?super` materialises ancestors per class.
"$TDB_LOADER" --loc="$TDB_DIR" "$INPUT"

if [[ "$OUTPUT" == "-" ]]; then
  "$TDB_QUERY" --loc="$TDB_DIR" --query="$QUERY"
else
  mkdir -p "$(dirname "$OUTPUT")"
  "$TDB_QUERY" --loc="$TDB_DIR" --query="$QUERY" > "$OUTPUT"
fi
