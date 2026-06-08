#!/usr/bin/env bash
# One-shot: ensure Docker daemon is up, terraform apply, wait for Spark Thrift,
# then run the demo SQL through beeline. macOS + Linux supported.
set -euo pipefail

cd "$(dirname "$0")"

# ENABLE_FLINK drives whether the optional Flink streaming engine comes up.
# Default off. The documented, primary way to turn it on is the interactive
# engine menu (select_engine, below). ENABLE_FLINK=1 in the environment is a
# silent non-interactive escape hatch (CI / scripted runs) that skips the menu.
ENABLE_FLINK="${ENABLE_FLINK:-0}"

# ---------------------------------------------------------------------------
# 0. Engine selection (interactive).
#
# Spark Thrift ALWAYS runs — it is the primary engine and executes the full V3
# batch demo (sql/demo.sql): MERGE/CDC, branches, time travel, deletion vectors,
# maintenance. Flink CANNOT run that script (Flink SQL has no MERGE INTO, no
# range() TVF, different catalog DDL and maintenance procedures), so we do NOT
# offer it as a Spark replacement. Instead Flink is purely ADDITIVE: a second
# engine on the SAME Lakekeeper catalog + MinIO bucket that runs a continuous
# datagen -> Iceberg streaming job, appending to demo.market.trades_stream and
# committing on each checkpoint (~10s) while Spark/beeline reads the same table
# and watches the count climb. That is the multi-engine interop story.
#
# TTY-aware: if stdin is not a terminal (CI, piped input), skip the prompt and
# keep the Spark-only default — unless ENABLE_FLINK=1 was passed explicitly.
# ---------------------------------------------------------------------------
select_engine() {
  if [ "${ENABLE_FLINK}" = "1" ]; then
    echo ">> ENABLE_FLINK=1 — Spark + Flink streaming engine (menu skipped)"
    return
  fi
  if [ ! -t 0 ]; then
    echo ">> non-interactive stdin — defaulting to Spark only (set ENABLE_FLINK=1 to add Flink)"
    return
  fi

  cat <<'MENU'
================================================================
  Engine selection
================================================================
  Spark Thrift Server is ALWAYS started — it runs the full V3
  demo (sql/demo.sql): MERGE/CDC, branches, time travel, deletion
  vectors, maintenance. This is the primary engine.

  You can ALSO add Apache Flink as a second, streaming engine on
  the SAME Lakekeeper catalog + MinIO bucket. Flink does NOT
  replace Spark and does NOT re-run the batch demo. Instead it:

    • runs a continuous streaming job (datagen -> Iceberg sink)
    • appends rows every second to demo.market.trades_stream
    • commits on each checkpoint (~10s)

  ...while Spark/beeline queries the SAME table and watches the
  row count climb. This demonstrates multi-engine interop on one
  Iceberg catalog — two engines, one source of truth.

  Cost: +2 containers (jobmanager, taskmanager), ~3-4 GiB extra
  RAM. Recommended on a host with >12 GiB free.
================================================================

  1) Spark only            (default)
  2) Spark + Flink streaming

MENU
  local choice
  read -r -p "  Pick [1/2]: " choice || true
  case "${choice}" in
    2) ENABLE_FLINK=1; echo ">> selected: Spark + Flink streaming" ;;
    *) ENABLE_FLINK=0; echo ">> selected: Spark only" ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. Docker daemon
# ---------------------------------------------------------------------------
# Try every Linux daemon flavor we know about, in order, returning on the
# first one that issues without error. The daemon-readiness poll in
# ensure_docker decides whether it actually came up, so a unit that exists
# but is slow is fine here.
start_linux_docker() {
  # System units: classic engine (docker.service), snap, then a generic
  # name match in case the distro ships something unusual.
  if command -v systemctl >/dev/null 2>&1; then
    local unit
    for unit in docker.service snap.docker.dockerd.service; do
      if systemctl list-unit-files "$unit" >/dev/null 2>&1 \
         && systemctl list-unit-files "$unit" 2>/dev/null | grep -q "$unit"; then
        echo ">> starting system unit: $unit"
        sudo systemctl start "$unit" && return 0
      fi
    done

    # Docker Desktop for Linux / rootless docker run as *user* units.
    for unit in docker-desktop docker.service; do
      if systemctl --user list-unit-files "$unit" >/dev/null 2>&1 \
         && systemctl --user list-unit-files "$unit" 2>/dev/null | grep -q "$unit"; then
        echo ">> starting user unit: $unit"
        systemctl --user start "$unit" && return 0
      fi
    done
  fi

  # Snap without a discoverable unit-file listing.
  if command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1; then
    echo ">> starting snap docker"
    sudo snap start docker && return 0
  fi

  # SysV / non-systemd init.
  if command -v service >/dev/null 2>&1; then
    echo ">> starting via service(8)"
    sudo service docker start && return 0
  fi

  return 1
}

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    echo ">> docker daemon already running"
    return
  fi

  echo ">> docker daemon not running — attempting to start"
  case "$(uname -s)" in
    Darwin)
      open -a Docker || { echo "!! could not launch Docker Desktop (is it installed?)"; exit 1; }
      ;;
    Linux)
      start_linux_docker || {
        echo "!! could not start a Docker daemon automatically."
        echo "   Diagnose with:"
        echo "     systemctl list-unit-files | grep -i docker"
        echo "     systemctl --user list-unit-files | grep -i docker"
        echo "     docker context ls"
        echo "     command -v dockerd"
        echo "   If Docker Engine is not installed: curl -fsSL https://get.docker.com | sudo sh"
        exit 1
      }
      ;;
    *)
      echo "!! unsupported OS — start Docker manually"; exit 1
      ;;
  esac

  echo -n ">> waiting for docker daemon"
  for _ in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then echo " — up"; return; fi
    echo -n "."
    sleep 2
  done
  echo
  echo "!! docker daemon did not become ready within 120s"
  exit 1
}

# ---------------------------------------------------------------------------
# 1b. Align Terraform's docker provider with the CLI's active context.
# The provider (`provider "docker" {}`) honors DOCKER_HOST but IGNORES
# `docker context`; the CLI honors both (DOCKER_HOST wins). If they disagree,
# Terraform builds the network on one daemon and bootstrap.sh's `docker run`
# looks on another -> "network lakedemo not found". Exporting the active
# context's endpoint makes terraform, bootstrap.sh, and image pulls all hit
# the same daemon. Child processes inherit the export.
# ---------------------------------------------------------------------------
align_docker_host() {
  if [ -n "${DOCKER_HOST:-}" ]; then
    echo ">> DOCKER_HOST already set: ${DOCKER_HOST}"
    return
  fi
  local ctx_host
  ctx_host=$(docker context inspect -f '{{ .Endpoints.docker.Host }}' 2>/dev/null || true)
  if [ -n "${ctx_host}" ]; then
    export DOCKER_HOST="${ctx_host}"
    echo ">> DOCKER_HOST=${DOCKER_HOST} (from active docker context '$(docker context show 2>/dev/null)')"
  fi
}

# ---------------------------------------------------------------------------
# 1c. Container internet preflight.
# `docker build` runs every RUN step inside a container, so the webapp build's
# `npm install` needs working DNS *inside containers* — not just on the host.
# The classic failure on a fresh VM: the host uses the systemd-resolved stub
# 127.0.0.53 in /etc/resolv.conf, which containers cannot reach, and Docker's
# 8.8.8.8 fallback is blocked. Symptom: host curl works, but the build hangs
# for ~15 min retrying npm fetches, then dies with "bad address". This probes
# container DNS and, if broken, points the daemon at the host's real upstream
# resolver and restarts it. Skip with SKIP_NET_CHECK=1 (e.g. fully offline run
# against pre-pulled images).
# ---------------------------------------------------------------------------
PROBE_IMG="busybox:1.36"
PROBE_HOST="registry.npmjs.org"

# True if a container can resolve PROBE_HOST. DNS is the failure mode here
# ("bad address"); resolution succeeding means the build can fetch.
container_dns_ok() {
  docker run --rm "${PROBE_IMG}" timeout 10 nslookup "${PROBE_HOST}" \
    >/dev/null 2>&1
}

# Emit the host's real upstream nameservers (one per line), skipping loopback
# stubs (127.x) that containers can't use. Tries systemd-resolved first, then
# /etc/resolv.conf. Always appends public fallbacks so we degrade gracefully.
host_upstream_dns() {
  if command -v resolvectl >/dev/null 2>&1; then
    resolvectl status 2>/dev/null \
      | awk -F': ' '/DNS Servers:/ {print $2}' | tr ' ' '\n'
  fi
  awk '/^nameserver/ && $2 !~ /^127\./ {print $2}' /etc/resolv.conf 2>/dev/null
  printf '1.1.1.1\n8.8.8.8\n'
}

# Merge a "dns" array into /etc/docker/daemon.json without clobbering other
# keys. Backs up the existing file first. Needs python3 (present on the demo
# VMs; bootstrap.sh already relies on it).
write_daemon_dns() {
  local servers_json="$1" f=/etc/docker/daemon.json
  sudo mkdir -p /etc/docker
  [ -f "$f" ] && sudo cp "$f" "$f.bak"
  sudo env DNS_JSON="${servers_json}" python3 - "$f" <<'PY'
import json, os, sys
path = sys.argv[1]
dns = json.loads(os.environ["DNS_JSON"])
data = {}
if os.path.exists(path):
    try:
        with open(path) as fh:
            data = json.load(fh) or {}
    except Exception:
        data = {}
data["dns"] = dns
with open(path, "w") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
PY
}

restart_docker() {
  if command -v systemctl >/dev/null 2>&1 \
     && systemctl list-unit-files docker.service 2>/dev/null | grep -q docker.service; then
    sudo systemctl restart docker
  elif command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1; then
    sudo snap restart docker
  elif command -v service >/dev/null 2>&1; then
    sudo service docker restart
  else
    return 1
  fi
  # Wait for the daemon to come back.
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

ensure_container_internet() {
  if [ "${SKIP_NET_CHECK:-0}" = "1" ]; then
    echo ">> SKIP_NET_CHECK=1 set — skipping container internet preflight"
    return
  fi
  # Pull the tiny probe image (pull goes through the daemon on the host network,
  # which works even when container *runtime* DNS is broken).
  docker pull -q "${PROBE_IMG}" >/dev/null 2>&1 || true

  echo -n ">> checking container internet (DNS to ${PROBE_HOST})"
  if container_dns_ok; then
    echo " — ok"
    return
  fi
  echo " — FAILED"

  # macOS / Docker Desktop: don't touch daemon.json (different path + restart
  # model). Point the user at Desktop's DNS settings instead.
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "!! Containers cannot resolve DNS. On Docker Desktop, check"
    echo "   Settings > Resources > Network, or set Docker Engine 'dns' in"
    echo "   Settings > Docker Engine, then retry. Bypass with SKIP_NET_CHECK=1."
    exit 1
  fi

  echo ">> configuring Docker daemon DNS from host upstream resolvers"
  local servers_json
  servers_json=$(host_upstream_dns | awk 'NF' | awk '!seen[$0]++' \
    | head -4 | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))')
  echo "   dns = ${servers_json}"
  write_daemon_dns "${servers_json}"

  echo ">> restarting Docker daemon to apply DNS"
  restart_docker || { echo "!! could not restart Docker; restart it manually"; exit 1; }

  echo -n ">> re-checking container internet"
  if container_dns_ok; then
    echo " — ok"
    return
  fi
  echo " — still FAILED"
  echo "!! Containers still cannot resolve ${PROBE_HOST} after setting daemon DNS."
  echo "   The VM's network likely blocks outbound DNS/HTTPS, or the upstream"
  echo "   resolver is wrong. Inspect: cat /etc/docker/daemon.json ; resolvectl status"
  echo "   Bypass (offline / pre-pulled images) with SKIP_NET_CHECK=1."
  exit 1
}

# ---------------------------------------------------------------------------
# 2. Terraform
# ---------------------------------------------------------------------------
# Adopt an orphan `lakedemo` network into state. After a daemon/context switch
# or a wiped state file, the network can exist on the daemon while Terraform's
# state doesn't know about it — then `apply` fails with "network with name
# lakedemo already exists". Importing it (non-destructive) lets apply proceed
# without tearing down a possibly-running stack. Must run after `init`.
reconcile_orphan_network() {
  local name=lakedemo
  docker network inspect "${name}" >/dev/null 2>&1 || return 0          # no network, nothing to do
  if terraform state list 2>/dev/null | grep -qx 'docker_network.lake'; then
    return 0                                                            # already tracked
  fi
  local id
  id=$(docker network inspect "${name}" -f '{{.Id}}' 2>/dev/null)
  echo ">> orphan docker network '${name}' exists but is not in terraform state — importing"
  if ! terraform import -input=false docker_network.lake "${id}"; then
    echo ">> import failed; removing the orphan network so apply can recreate it"
    docker network rm "${name}" \
      || echo "!! could not remove '${name}' (containers attached?). Run: docker network rm ${name}"
  fi
}

run_terraform() {
  if [ ! -d .terraform ]; then
    echo ">> terraform init"
    terraform init -input=false
  fi
  reconcile_orphan_network
  echo ">> terraform apply (enable_flink=$([ "${ENABLE_FLINK}" = "1" ] && echo true || echo false))"
  # Map the engine choice to the Terraform bool. Flink resources are count-gated
  # on enable_flink, so false => zero Flink containers, byte-for-byte the
  # original Spark-only stack.
  terraform apply -auto-approve -input=false \
    -var "enable_flink=$([ "${ENABLE_FLINK}" = "1" ] && echo true || echo false)"
}

# ---------------------------------------------------------------------------
# 3. Wait for Spark Thrift Server (first start pulls Iceberg jars from Maven)
# ---------------------------------------------------------------------------
wait_for_thrift() {
  echo -n ">> waiting for spark-thrift on :10000 (Maven download on first run can take ~1-2 min)"
  for _ in $(seq 1 120); do
    if docker exec spark-thrift bash -c \
        '/opt/spark/bin/beeline -u jdbc:hive2://localhost:10000 -e "SELECT 1" >/dev/null 2>&1'; then
      echo " — ready"
      return
    fi
    echo -n "."
    sleep 3
  done
  echo
  echo "!! Thrift Server did not accept JDBC within 6 min. Check: docker logs spark-thrift"
  exit 1
}

# ---------------------------------------------------------------------------
# 3b. Wait for the Flink session cluster (gated on ENABLE_FLINK).
# First start pulls the flink:1.20 image and curls the Iceberg + Hadoop jars
# into /opt/flink/lib, so the taskmanager takes a bit to register. Poll the
# jobmanager REST /overview until at least one taskmanager has joined — mirrors
# wait_for_thrift's retry loop.
# ---------------------------------------------------------------------------
wait_for_flink() {
  [ "${ENABLE_FLINK}" = "1" ] || return 0
  echo -n ">> waiting for Flink cluster on :8081 (image pull + jar staging on first run)"
  for _ in $(seq 1 100); do
    # /overview returns {"taskmanagers":N,...}; N>=1 means the TM registered.
    if curl -s localhost:8081/overview 2>/dev/null | grep -q '"taskmanagers":[1-9]'; then
      echo " — ready"
      return
    fi
    echo -n "."
    sleep 3
  done
  echo
  echo "!! Flink cluster did not become ready within 5 min. Check: docker logs flink-jobmanager"
  exit 1
}

# ---------------------------------------------------------------------------
# 3c. Submit the streaming job (gated on ENABLE_FLINK).
#
# Runs flink/sql/stream.sql through the embedded SQL client — same docker-exec
# pattern as beeline for Spark, no separate SQL Gateway container needed. The
# script creates the shared REST catalog, the trades_stream sink table, a
# datagen source, and a long-running INSERT. sql-client submits the streaming
# INSERT and RETURNS (table.dml-sync defaults to false), leaving the job running
# on the session cluster — commits happen on each checkpoint (~10s).
# ---------------------------------------------------------------------------
start_flink_stream() {
  [ "${ENABLE_FLINK}" = "1" ] || return 0
  echo ">> submitting Flink streaming job (datagen -> demo.market.trades_stream)"
  docker exec flink-jobmanager /opt/flink/bin/sql-client.sh -f /opt/flink/sql/stream.sql \
    || { echo "!! Flink job submission failed. Check: docker logs flink-jobmanager"; exit 1; }

  # IMPORTANT: sql-client.sh -f returns exit 0 EVEN WHEN a statement fails (it
  # prints [ERROR] and exits clean), so the `||` guard above is necessary-but-
  # not-sufficient — it catches a non-running client, not a job that submits and
  # then dies. And "submitted" != "writing": the Iceberg sink makes rows visible
  # only on a COMPLETED checkpoint, and a misconfigured job loops in RESTARTING,
  # committing nothing. So verify the real signal: the job reached >=1 completed
  # checkpoint. This mirrors wait_for_thrift — prove the engine actually works,
  # don't just assume the container is up.
  echo -n ">> confirming the stream commits (waiting for first Flink checkpoint)"
  local jid="" ok=0
  for _ in $(seq 1 40); do
    # First RUNNING job's id, then its completed-checkpoint count, via the REST
    # API (python3 is already a hard dep — bootstrap.sh relies on it).
    jid=$(curl -s localhost:8081/jobs/overview 2>/dev/null \
      | python3 -c 'import sys,json
try:
  js=[j for j in json.load(sys.stdin)["jobs"] if j["state"]=="RUNNING"]
  print(js[0]["jid"] if js else "")
except Exception: print("")' 2>/dev/null)
    if [ -n "${jid}" ]; then
      if curl -s "localhost:8081/jobs/${jid}/checkpoints" 2>/dev/null \
          | grep -qE '"completed":[1-9]'; then
        ok=1; break
      fi
    fi
    echo -n "."
    sleep 3
  done
  if [ "${ok}" != "1" ]; then
    echo
    echo "!! Flink job did not reach a completed checkpoint. It likely submitted"
    echo "   then failed (RESTARTING loop) — zero rows will be committed."
    echo "   Check: docker logs flink-taskmanager ; http://localhost:8081"
    exit 1
  fi
  echo " — committing"

  cat <<'INTEROP'

   Flink is now streaming into the SAME Iceberg catalog Spark uses.
   Watch multi-engine interop — run this twice, ~10s apart, and the
   count climbs (Flink writing, Spark reading, one catalog):

     docker exec spark-thrift /opt/spark/bin/beeline \
       -u jdbc:hive2://localhost:10000 \
       -e "SELECT count(*) FROM demo.market.trades_stream;"

   Flink web UI (the running INSERT job): http://localhost:8081
INTEROP
}

# ---------------------------------------------------------------------------
# 4. Run demo SQL (opt-in only).
# The stack comes up EMPTY by default so the webapp clickthrough starts from a
# blank catalog and the user runs each step themselves. Set RUN_DEMO=1 to batch
# the whole sql/demo.sql instead. (NO_DEMO is still honored as a no-op for
# backward compatibility, but skipping is now the default.)
# ---------------------------------------------------------------------------
run_demo() {
  if [ "${RUN_DEMO:-0}" != "1" ]; then
    echo ">> stack is empty (set RUN_DEMO=1 to batch sql/demo.sql; otherwise run steps from the webapp)"
    return
  fi
  echo ">> RUN_DEMO=1 set — running sql/demo.sql via beeline"
  docker exec spark-thrift /opt/spark/bin/beeline \
    -u jdbc:hive2://localhost:10000 -f /opt/demo/demo.sql
}

select_engine
ensure_docker
align_docker_host
ensure_container_internet
run_terraform
wait_for_thrift
run_demo
wait_for_flink
start_flink_stream

echo
echo "Stack is up. Endpoints:"
terraform output
echo
echo "Webapp: http://localhost:3030 (External: http://$(curl -s https://ifconfig.me/ip):3030)"
