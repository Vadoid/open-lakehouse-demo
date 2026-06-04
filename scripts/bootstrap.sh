#!/usr/bin/env bash
# Creates the MinIO bucket, bootstraps Lakekeeper, and registers the warehouse.
# Invoked by the null_resource in main.tf. Idempotent-ish: tolerates "already done".
set -euo pipefail

LK="http://localhost:8181"

echo ">> waiting for Lakekeeper to be healthy..."
for i in $(seq 1 60); do
  if curl -sf "${LK}/health" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo ">> creating MinIO bucket '${BUCKET}'..."
# Resolve the network lake-minio is actually attached to
NET=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' lake-minio 2>/dev/null || true)
NET=${NET:-${NETWORK}}
if ! docker network inspect "${NET}" >/dev/null 2>&1; then
  echo "!! docker network '${NET}' not found by this CLI."
  exit 1
fi
echo ">> using network '${NET}'"

docker run --rm --network "${NET}" --entrypoint /bin/sh minio/mc -c "
  mc alias set lake http://lake-minio:9000 '${S3_ACCESS_KEY}' '${S3_SECRET_KEY}' &&
  mc mb --ignore-existing lake/${BUCKET}
"

echo ">> bootstrapping Lakekeeper (sets initial admin / first project)..."
curl -sf -X POST "${LK}/management/v1/bootstrap" \
  -H "Content-Type: application/json" \
  -d '{"accept-terms-of-use": true}' || echo "   (already bootstrapped, continuing)"

echo ">> creating warehouse '${WAREHOUSE}' on MinIO..."
curl -sf -X POST "${LK}/management/v1/warehouse" \
  -H "Content-Type: application/json" \
  -d @- <<JSON || echo "   (warehouse may already exist, continuing)"
{
  "warehouse-name": "${WAREHOUSE}",
  "storage-profile": {
    "type": "s3",
    "bucket": "${BUCKET}",
    "key-prefix": "demo",
    "endpoint": "http://lake-minio:9000",
    "region": "us-east-1",
    "path-style-access": true,
    "flavor": "s3-compat",
    "sts-enabled": false
  },
  "storage-credential": {
    "type": "s3",
    "credential-type": "access-key",
    "aws-access-key-id": "${S3_ACCESS_KEY}",
    "aws-secret-access-key": "${S3_SECRET_KEY}"
  }
}
JSON

echo ">> creating 'default' namespace in warehouse '${WAREHOUSE}'..."
# Spark Thrift opens each new JDBC session with USE default; without this
# namespace, every beeline connection fails with NoSuchNamespaceException.
# Lakekeeper's REST prefix is the warehouse UUID, discovered via /v1/config.
#
# Retry the fetch: right after warehouse registration the /config endpoint can
# briefly 404 or return a non-JSON body. A bare `curl -sf | python3 json.load`
# under `set -o pipefail` would then die with JSONDecodeError and fail the whole
# null_resource.bootstrap. Poll until we get a parseable prefix.
PREFIX=""
for _ in $(seq 1 30); do
  body=$(curl -sf "${LK}/catalog/v1/config?warehouse=${WAREHOUSE}" \
    -H "Authorization: Bearer dummy" 2>/dev/null) || { sleep 2; continue; }
  PREFIX=$(printf '%s' "${body}" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
p = (d.get("defaults") or {}).get("prefix") or (d.get("overrides") or {}).get("prefix")
print(p or "")
' 2>/dev/null) || PREFIX=""
  [ -n "${PREFIX}" ] && break
  sleep 2
done
if [ -z "${PREFIX}" ]; then
  echo "!! could not resolve warehouse prefix from ${LK}/catalog/v1/config?warehouse=${WAREHOUSE}"
  echo "   Lakekeeper is up but the warehouse '${WAREHOUSE}' may not have registered."
  echo "   Last response body: ${body:-<empty>}"
  exit 1
fi
echo ">> warehouse prefix: ${PREFIX}"
curl -sf -X POST "${LK}/catalog/v1/${PREFIX}/namespaces" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy" \
  -d '{"namespace": ["default"]}' >/dev/null \
  || echo "   (namespace may already exist, continuing)"

echo ">> bootstrap complete."
