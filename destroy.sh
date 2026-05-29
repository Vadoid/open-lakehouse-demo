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

CONTAINERS=(lake-postgres lake-minio lakekeeper lake-migrate spark-thrift demo-webapp)
NETWORK=lakedemo

# ---------------------------------------------------------------------------
# Align with the CLI's active context, same as start.sh. The Terraform docker
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
  docker "${hostflag[@]}" info >/dev/null 2>&1 || return 0   # daemon not reachable here

  local found=0 c
  for c in "${CONTAINERS[@]}"; do
    if docker "${hostflag[@]}" inspect "$c" >/dev/null 2>&1; then
      echo ">> [$label] removing container $c"
      docker "${hostflag[@]}" rm -f "$c" >/dev/null 2>&1 || true
      found=1
    fi
  done

  if docker "${hostflag[@]}" network inspect "$NETWORK" >/dev/null 2>&1; then
    echo ">> [$label] removing network $NETWORK"
    docker "${hostflag[@]}" network rm "$NETWORK" >/dev/null 2>&1 \
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

echo
echo "Teardown complete. Verify with: docker ps -a | grep -E 'lake|spark|webapp'"
