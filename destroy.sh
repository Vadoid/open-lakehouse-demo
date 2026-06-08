#!/usr/bin/env bash
# Tear the stack down completely. `terraform destroy` alone often leaves
# survivors: containers stranded on a different daemon than the provider now
# targets (DOCKER_HOST vs `docker context` drift), the spark-thrift container
# reviving under its `restart = unless-stopped` policy mid-destroy, or
# resources that drifted out of Terraform state. This runs the destroy, then
# force-removes the known containers + network by name on every daemon socket
# we can find, so the box is actually clean.
set -uo pipefail   # intentionally NOT -e: cleanup is best-effort, keep going

cd "$(dirname "$0")"

# flink-* are present only when deployed with the optional Flink engine; listing
# them here is harmless when absent (sweep skips containers it can't inspect).
CONTAINERS=(lake-postgres lake-minio lakekeeper lake-migrate spark-thrift demo-webapp flink-jobmanager flink-taskmanager)
NETWORK=lakedemo

# ---------------------------------------------------------------------------
# 0. Query running webapp storage configurations for GCS bucket cleanup
# ---------------------------------------------------------------------------
GCS_BUCKET=""
IS_CUSTOM_BUCKET=""
HOST_SUFFIX=""
PROJECT_ID=""

if docker inspect demo-webapp >/dev/null 2>&1; then
  echo ">> querying active storage configuration from webapp..."
  storage_json=$(curl -s --connect-timeout 2 http://localhost:3030/api/storage-setup || true)
  if [ -n "$storage_json" ]; then
    storage_type=$(echo "$storage_json" | grep -o '"type":"[^"]*"' | head -n1 | cut -d'"' -f4 || true)
    if [ "$storage_type" = "gcs" ]; then
      GCS_BUCKET=$(echo "$storage_json" | grep -o '"bucket":"[^"]*"' | head -n1 | cut -d'"' -f4 || true)
      IS_CUSTOM_BUCKET=$(echo "$storage_json" | grep -o '"isCustomBucket":[^,}]*' | head -n1 | tr -d ' ' | cut -d':' -f2 || true)
      HOST_SUFFIX=$(echo "$storage_json" | grep -o '"hostSuffix":"[^"]*"' | head -n1 | cut -d'"' -f4 || true)
      PROJECT_ID=$(echo "$storage_json" | grep -o '"projectId":"[^"]*"' | head -n1 | cut -d'"' -f4 || true)
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Align with the CLI's active context, same as deploy.sh. The Terraform docker
# provider honors DOCKER_HOST but ignores `docker context`; exporting the
# context endpoint makes `terraform destroy` and the docker CLI hit one daemon.
# ---------------------------------------------------------------------------
if [ -z "${DOCKER_HOST:-}" ]; then
  ctx_host=$(docker context inspect -f '{{ .Endpoints.docker.Host }}' 2>/dev/null || true)
  if [ -n "${ctx_host}" ]; then
    export DOCKER_HOST="${ctx_host}"
    echo ">> DOCKER_HOST=${DOCKER_HOST} (from active docker context)"
  fi
fi

# ---------------------------------------------------------------------------
# 1. Terraform destroy (only if a state/config is present).
# ---------------------------------------------------------------------------
if [ -d .terraform ] || [ -f terraform.tfstate ]; then
  echo ">> terraform destroy"
  terraform destroy -auto-approve -input=false || echo "!! terraform destroy returned non-zero; continuing with manual cleanup"
else
  echo ">> no terraform state here; skipping terraform destroy, doing manual cleanup"
fi

# ---------------------------------------------------------------------------
# 2. Force-remove leftover containers + network on a given docker endpoint.
# ---------------------------------------------------------------------------
sweep() {
  local hostflag=("$@")   # e.g. (-H unix:///var/run/docker.sock) or empty
  local label="${hostflag[*]:-current}"
  docker ${hostflag[@]+"${hostflag[@]}"} info >/dev/null 2>&1 || return 0   # daemon not reachable here

  local found=0 c
  for c in "${CONTAINERS[@]}"; do
    if docker ${hostflag[@]+"${hostflag[@]}"} inspect "$c" >/dev/null 2>&1; then
      echo ">> [$label] removing container $c"
      docker ${hostflag[@]+"${hostflag[@]}"} rm -f "$c" >/dev/null 2>&1 || true
      found=1
    fi
  done

  if docker ${hostflag[@]+"${hostflag[@]}"} network inspect "$NETWORK" >/dev/null 2>&1; then
    echo ">> [$label] removing network $NETWORK"
    docker ${hostflag[@]+"${hostflag[@]}"} network rm "$NETWORK" >/dev/null 2>&1 \
      || echo "   ($NETWORK still in use? rerun after containers are gone)"
    found=1
  fi

  [ "$found" = 0 ] && echo ">> [$label] nothing to clean"
}

# Current daemon (whatever DOCKER_HOST / context points at).
sweep

# Best-effort sweep of the other common sockets, in case containers were
# created on a daemon the current context no longer targets (the drift case).
for sock in /var/run/docker.sock "${XDG_RUNTIME_DIR:-}/docker.sock" "${HOME}/.docker/run/docker.sock"; do
  [ -S "$sock" ] || continue
  # Skip if this socket is already the active endpoint we just swept.
  [ "unix://$sock" = "${DOCKER_HOST:-}" ] && continue
  sweep -H "unix://$sock"
done

# ---------------------------------------------------------------------------
# 3. Wipe local persisted state (the webapp's storage-config volume). This is
# host-side, so `terraform destroy` leaves it behind; without removing it the
# next deploy would skip the setup screen and reuse the old config + SA key.
# Local only — always safe to delete.
# ---------------------------------------------------------------------------
if [ -d .demo-state ]; then
  echo ">> removing local persisted state (.demo-state)"
  rm -rf .demo-state
fi

# ---------------------------------------------------------------------------
# 4. Optionally clean up the sandbox GCS bucket + service account.
#
# OFF by default: a local teardown shouldn't silently delete cloud resources,
# and `gcloud` can demand an interactive reauth mid-script. Leaving the bucket
# in place also lets a redeploy reuse it instead of re-minting the SA key and
# waiting out org-policy propagation every time. Opt in with CLEANUP_GCS=1.
# ---------------------------------------------------------------------------
SA_EMAIL=""
if [ -n "${PROJECT_ID}" ] && [ -n "${HOST_SUFFIX}" ]; then
  SA_EMAIL="lakehouse-catalog-${HOST_SUFFIX}@${PROJECT_ID}.iam.gserviceaccount.com"
fi

if [ -n "${GCS_BUCKET}" ] || [ -n "${SA_EMAIL}" ]; then
  if [ "${CLEANUP_GCS:-0}" = "1" ]; then
    if [ -n "${GCS_BUCKET}" ] && [ "${IS_CUSTOM_BUCKET}" = "false" ]; then
      echo ">> removing sandbox GCS bucket: gs://${GCS_BUCKET}"
      # `buckets delete` needs an empty bucket (there is no --recursive); empty
      # it first, then delete the bucket itself.
      gcloud storage rm --recursive "gs://${GCS_BUCKET}/**" --quiet 2>/dev/null || true
      gcloud storage buckets delete "gs://${GCS_BUCKET}" --quiet \
        || echo "!! failed to delete GCS bucket gs://${GCS_BUCKET}; please clean it up manually"
    elif [ -n "${GCS_BUCKET}" ]; then
      echo ">> skipping GCS bucket gs://${GCS_BUCKET} (custom bucket protection active)"
    fi
    if [ -n "${SA_EMAIL}" ]; then
      echo ">> removing sandbox service account: ${SA_EMAIL}"
      gcloud iam service-accounts delete "${SA_EMAIL}" --project="${PROJECT_ID}" --quiet \
        || echo "!! failed to delete service account ${SA_EMAIL}; please clean it up manually"
    fi
  else
    echo ">> leaving GCS sandbox resources in place (set CLEANUP_GCS=1 to delete). To remove manually:"
    [ -n "${GCS_BUCKET}" ] && [ "${IS_CUSTOM_BUCKET}" = "false" ] \
      && echo "     gcloud storage rm --recursive gs://${GCS_BUCKET} && gcloud storage buckets delete gs://${GCS_BUCKET}"
    [ -n "${SA_EMAIL}" ] \
      && echo "     gcloud iam service-accounts delete ${SA_EMAIL} --project=${PROJECT_ID}"
  fi
fi

echo
echo "Teardown complete. Verify with: docker ps -a | grep -E 'lake|spark|webapp|flink'"
