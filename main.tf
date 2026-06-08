terraform {
  required_providers {
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.0"
    }
  }
}

provider "docker" {}

data "http" "external_ip" {
  url = "https://ifconfig.me/ip"
}

locals {
  external_ip = chomp(data.http.external_ip.response_body)
}

resource "docker_network" "lake" {
  name = "lakedemo"
}

# ----------------------------------------------------------------------------
# Postgres  (Lakekeeper metadata backend; Lakekeeper requires Postgres >= 15)
# ----------------------------------------------------------------------------
resource "docker_image" "postgres" {
  name = "postgres:15"
}

resource "docker_container" "postgres" {
  name  = "lake-postgres"
  image = docker_image.postgres.image_id
  networks_advanced { name = docker_network.lake.name }
  env = [
    "POSTGRES_USER=${var.pg_user}",
    "POSTGRES_PASSWORD=${var.pg_password}",
    "POSTGRES_DB=catalog",
  ]
  healthcheck {
    test     = ["CMD-SHELL", "pg_isready -U ${var.pg_user} -d catalog"]
    interval = "5s"
    timeout  = "3s"
    retries  = 10
  }
}

# ----------------------------------------------------------------------------
# MinIO  (S3-compatible object store for the Iceberg warehouse)
# ----------------------------------------------------------------------------
resource "docker_image" "minio" {
  name = "minio/minio:RELEASE.2025-04-22T22-12-26Z"
}

resource "docker_container" "minio" {
  name    = "lake-minio"
  image   = docker_image.minio.image_id
  command = ["server", "/data", "--console-address", ":9001"]
  networks_advanced { name = docker_network.lake.name }
  env = [
    "MINIO_ROOT_USER=${var.s3_access_key}",
    "MINIO_ROOT_PASSWORD=${var.s3_secret_key}",
  ]
  ports {
    internal = 9000
    external = 9000
  }
  ports {
    internal = 9001
    external = 9001
  }
}

# ----------------------------------------------------------------------------
# Lakekeeper  (Rust-native Iceberg REST catalog) — unsecured / no IdP for demo
# Runs DB migration then serves. REST API: /catalog  Management API: /management
# ----------------------------------------------------------------------------
resource "docker_image" "lakekeeper" {
  name = "quay.io/lakekeeper/catalog:${var.lakekeeper_version}"
}

resource "docker_container" "lakekeeper_migrate" {
  name       = "lake-migrate"
  image      = docker_image.lakekeeper.image_id
  command    = ["migrate"]
  must_run   = false
  attach     = true
  depends_on = [docker_container.postgres]
  networks_advanced { name = docker_network.lake.name }
  env = local.lakekeeper_env
}

resource "docker_container" "lakekeeper" {
  name       = "lakekeeper"
  image      = docker_image.lakekeeper.image_id
  command    = ["serve"]
  depends_on = [docker_container.lakekeeper_migrate]
  networks_advanced { name = docker_network.lake.name }
  env = local.lakekeeper_env
  ports {
    internal = 8181
    external = 8181
  }
}

locals {
  pg_url = "postgres://${var.pg_user}:${var.pg_password}@lake-postgres:5432/catalog"
  lakekeeper_env = [
    "LAKEKEEPER__PG_DATABASE_URL_READ=${local.pg_url}",
    "LAKEKEEPER__PG_DATABASE_URL_WRITE=${local.pg_url}",
    "LAKEKEEPER__PG_ENCRYPTION_KEY=demo-only-not-a-real-key",
    "LAKEKEEPER__AUTHZ_BACKEND=allow-all",
  ]
  host_suffix = substr(md5(abspath(path.module)), 0, 8)
}

# ----------------------------------------------------------------------------
# Bootstrap: create MinIO bucket, bootstrap Lakekeeper, create the warehouse.
# Imperative steps live in a script (real-world pattern: TF stands up infra,
# a provisioner handles catalog bootstrap).
# ----------------------------------------------------------------------------
resource "null_resource" "bootstrap" {
  depends_on = [docker_container.lakekeeper, docker_container.minio]
  triggers   = { always = timestamp() }
  provisioner "local-exec" {
    command = "${path.module}/scripts/bootstrap.sh"
    environment = {
      NETWORK       = docker_network.lake.name
      S3_ACCESS_KEY = var.s3_access_key
      S3_SECRET_KEY = var.s3_secret_key
      WAREHOUSE     = var.warehouse
      BUCKET        = var.bucket
    }
  }
}

# ----------------------------------------------------------------------------
# Spark + Thrift Server (HiveServer2 JDBC on :10000). SQL-only, no notebook.
# Iceberg packages are fetched at first start (needs internet).
# ----------------------------------------------------------------------------
resource "docker_image" "spark" {
  # Java 17 variant required — Iceberg 1.11 jars are compiled for Java 17
  # (class file 61). The default apache/spark:3.5.6 ships Java 11 and crashes
  # with UnsupportedClassVersionError on session init.
  name = "apache/spark:3.5.6-scala2.12-java17-ubuntu"
}

resource "docker_container" "spark_thrift" {
  name       = "spark-thrift"
  image      = docker_image.spark.image_id
  depends_on = [null_resource.bootstrap]
  user       = "root"
  networks_advanced { name = docker_network.lake.name }
  ports {
    internal = 10000
    external = 10000
  }
  volumes {
    host_path      = abspath("${path.module}/spark/spark-defaults.conf")
    container_path = "/opt/spark/conf/spark-defaults.conf"
    read_only      = true
  }
  volumes {
    host_path      = abspath("${path.module}/sql")
    container_path = "/opt/demo"
    read_only      = true
  }
  # Stage Iceberg jars into /opt/spark/jars (system classloader), then start
  # the Thrift Server.
  #
  # Self-healing: after start-thriftserver.sh forks the JVM, we watch its PID
  # and exit the container when it dies (OOM-kill, crash, anything). Docker's
  # restart policy below revives the container, so the demo recovers without
  # operator action. Without this, PID 1 was `tail -F` and stayed alive even
  # after the JVM zombied — the container looked healthy but Thrift refused.
  command = [
    "/bin/bash", "-c",
    <<-EOT
      set -e
      ICEBERG_VER=1.11.0
      MAVEN=https://repo1.maven.org/maven2/org/apache/iceberg
      for j in iceberg-spark-runtime-3.5_2.12-$${ICEBERG_VER} iceberg-aws-bundle-$${ICEBERG_VER} iceberg-gcp-bundle-$${ICEBERG_VER}; do
        artifact=$${j%-$${ICEBERG_VER}}
        dst=/opt/spark/jars/$${j}.jar
        if [ ! -f $${dst} ]; then
          echo ">> fetching $${j}.jar"
          curl -fSL -o $${dst} $${MAVEN}/$${artifact}/$${ICEBERG_VER}/$${j}.jar
        fi
      done
      /opt/spark/sbin/start-thriftserver.sh
      # Wait up to 30s for the JVM to appear. Match only the Java process
      # (PID 1 is this bash and its argv contains "HiveThriftServer2" too).
      JVM_PID=""
      for _ in $(seq 1 30); do
        JVM_PID=$(pgrep -f 'org.apache.spark.deploy.SparkSubmit.*HiveThriftServer2' | head -1)
        [ -n "$${JVM_PID}" ] && break
        sleep 1
      done
      if [ -z "$${JVM_PID}" ]; then
        echo ">> JVM failed to start; bailing"
        exit 1
      fi
      echo ">> supervising HiveThriftServer2 PID $${JVM_PID}"
      tail -F /opt/spark/logs/*.out &
      TAIL_PID=$!
      while kill -0 $${JVM_PID} 2>/dev/null; do sleep 5; done
      echo ">> JVM PID $${JVM_PID} exited; restarting container"
      kill $${TAIL_PID} 2>/dev/null || true
      exit 1
    EOT
    ,
  ]
  restart  = "unless-stopped"
  healthcheck {
    test         = ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/10000' 2>/dev/null"]
    interval     = "15s"
    timeout      = "3s"
    retries      = 3
    start_period = "60s"
  }
}

# ----------------------------------------------------------------------------
# Flink streaming engine (OPTIONAL — count-gated on var.enable_flink).
#
# A standalone Flink 1.20 SESSION cluster (jobmanager + taskmanager) that streams
# synthetic trades into the SAME Lakekeeper REST catalog + MinIO bucket Spark
# uses. This is ADDITIVE: Spark Thrift stays the primary engine and runs the full
# V3 batch demo; Flink does NOT replace it and does NOT re-run demo.sql. It
# demonstrates multi-engine interop — Flink writes demo.market.trades_stream,
# Spark reads it, one catalog, one source of truth. deploy.sh submits the job
# (flink/sql/stream.sql) and shows the row count climbing.
#
# Java 17 image to match Spark (Iceberg 1.11 jars are class-file 61).
# ----------------------------------------------------------------------------
resource "docker_image" "flink" {
  count = var.enable_flink ? 1 : 0
  name  = "flink:1.20-scala_2.12-java17"
}

locals {
  # Jar staging idiom mirrors spark_thrift's: curl the Iceberg (+ Hadoop) jars
  # into /opt/flink/lib (Flink's system classloader) at container start, guarded
  # by an existence check so a restart doesn't re-download. Four jars:
  #   - iceberg-flink-runtime-1.20  : Iceberg sink/catalog for Flink 1.20
  #   - iceberg-aws-bundle          : S3FileIO for MinIO (same bundle Spark uses)
  #   - iceberg-gcp-bundle          : GCSFileIO for a GCS warehouse (same bundle
  #     Spark stages). ResolvingFileIO picks S3 vs GCS by URI scheme, so both
  #     bundles must be present to support either storage target.
  #   - flink-shaded-hadoop-2-uber  : REQUIRED. iceberg-flink-runtime does NOT
  #     shade Hadoop and the flink image ships none, so CREATE CATALOG throws
  #     ClassNotFoundException: org.apache.hadoop.conf.Configuration without it.
  flink_jar_stage = <<-EOT
    set -e
    ICEBERG_VER=1.11.0
    FLINK_MINOR=1.20
    HADOOP_UBER=flink-shaded-hadoop-2-uber-2.8.3-10.0
    ICE_MAVEN=https://repo1.maven.org/maven2/org/apache/iceberg
    FLINK_MAVEN=https://repo1.maven.org/maven2/org/apache/flink/flink-shaded-hadoop-2-uber/2.8.3-10.0
    fetch() { # $1 dest filename, $2 url
      dst=/opt/flink/lib/$${1}
      if [ ! -f $${dst} ]; then echo ">> fetching $${1}"; curl -fSL -o $${dst} "$${2}"; fi
    }
    fetch iceberg-flink-runtime-$${FLINK_MINOR}-$${ICEBERG_VER}.jar $${ICE_MAVEN}/iceberg-flink-runtime-$${FLINK_MINOR}/$${ICEBERG_VER}/iceberg-flink-runtime-$${FLINK_MINOR}-$${ICEBERG_VER}.jar
    fetch iceberg-aws-bundle-$${ICEBERG_VER}.jar $${ICE_MAVEN}/iceberg-aws-bundle/$${ICEBERG_VER}/iceberg-aws-bundle-$${ICEBERG_VER}.jar
    fetch iceberg-gcp-bundle-$${ICEBERG_VER}.jar $${ICE_MAVEN}/iceberg-gcp-bundle/$${ICEBERG_VER}/iceberg-gcp-bundle-$${ICEBERG_VER}.jar
    fetch $${HADOOP_UBER}.jar $${FLINK_MAVEN}/$${HADOOP_UBER}.jar
  EOT
}

resource "docker_container" "flink_jobmanager" {
  count      = var.enable_flink ? 1 : 0
  name       = "flink-jobmanager"
  image      = docker_image.flink[0].image_id
  user       = "root"
  # Catalog must exist before the stream job points at it — same gate as Spark.
  depends_on = [null_resource.bootstrap]
  networks_advanced { name = docker_network.lake.name }
  ports {
    internal = 8081
    external = 8081
  }
  # Standard-YAML config (Flink 1.20). Mounting it REPLACES the image default,
  # so flink/config.yaml re-supplies the Java-17 --add-opens flags (see comment
  # there) — without them the streaming job dies every checkpoint.
  volumes {
    host_path      = abspath("${path.module}/flink/config.yaml")
    container_path = "/opt/flink/conf/config.yaml"
    read_only      = true
  }
  # stream.sql — submitted by the resubmit supervisor via sql-client.sh -f.
  volumes {
    host_path      = abspath("${path.module}/flink/sql")
    container_path = "/opt/flink/sql"
    read_only      = true
  }
  # Shared control channel with the webapp (same host dir the webapp mounts at
  # /data). The streaming job does NOT start on its own — the bonus-screen "Start
  # streaming" button writes a flag file here, and the supervisor only submits
  # the stream while that flag exists. This is the only way the webapp (which
  # can't docker-exec and has no Flink SQL gateway) can ask the cluster to run.
  volumes {
    host_path      = abspath("${path.module}/.demo-state")
    container_path = "/control"
  }
  # Stage the Iceberg jars, then start the jobmanager UNDER a resubmit supervisor
  # (mirrors spark-thrift's PID-watch supervisor above).
  #
  # WHY a supervisor: (1) the stream is user-triggered — it must NOT start on
  # deploy, only when the bonus-screen "Start streaming" button arms a shared flag
  # file; the webapp can't docker-exec and there's no Flink SQL gateway, so the
  # supervisor is the only thing that can submit the SQL. (2) The webapp lets the
  # user switch the storage target (MinIO <-> GCS) at runtime, which DROPs and
  # re-registers the Lakekeeper warehouse (webapp/app/api/storage-setup/route.ts),
  # killing the long-running INSERT. The supervisor reruns the idempotent
  # stream.sql whenever it is ARMED and no job is live, so the stream both starts
  # on demand and self-heals against whatever warehouse is currently registered
  # (stream.sql's CREATE DATABASE/TABLE IF NOT EXISTS recreate the table on a
  # freshly-registered warehouse, on MinIO or GCS).
  #
  # This depends on flink/config.yaml's bounded restart-strategy: a job whose
  # table was dropped must exhaust retries and reach terminal FAILED so the
  # supervisor sees "no live job" and resubmits. With unbounded retries it would
  # loop RESTARTING forever and never resubmit.
  command = [
    "/bin/bash", "-c",
    <<-EOT
      ${local.flink_jar_stage}
      # Start the JM as a background daemon so this script (container PID 1) stays
      # in the foreground as the supervisor. (start-foreground would block here.)
      /opt/flink/bin/jobmanager.sh start
      # Capture the JM JVM pid; jobmanager.sh forks the JVM, so race the fork like
      # the spark block races its pgrep.
      JM_PID=""
      for _ in $(seq 1 30); do
        JM_PID=$(pgrep -f StandaloneSessionClusterEntrypoint | head -1)
        [ -n "$JM_PID" ] && break
        sleep 1
      done
      if [ -z "$JM_PID" ]; then echo ">> jobmanager JVM failed to start; bailing"; exit 1; fi
      echo ">> supervising jobmanager JVM PID $JM_PID"
      # Keep `docker logs flink-jobmanager` useful (troubleshooting docs lean on it).
      tail -F /opt/flink/log/*.log 2>/dev/null &
      TAIL_PID=$!
      # Wait for a taskmanager to register before the first submit.
      echo ">> waiting for a taskmanager to register"
      for _ in $(seq 1 60); do
        curl -s localhost:8081/overview 2>/dev/null | grep -q '"taskmanagers":[1-9]' && break
        sleep 2
      done
      # Shared control flag with the webapp. The stream is OFF until the bonus
      # screen's "Start streaming" button writes this file. /control is a bind
      # mount of the host .demo-state dir (also the webapp's /data), so the flag
      # the webapp touches at /data/flink-stream.on appears here. chmod is
      # defensive — both containers run as root, so this normally no-ops.
      STREAM_FLAG=/control/flink-stream.on
      mkdir -p /control 2>/dev/null || true
      chmod 777 /control 2>/dev/null || true
      echo ">> supervisor ready — stream stays OFF until the webapp arms $STREAM_FLAG"
      # ---- resubmit supervisor loop ----
      backoff=15
      while true; do
        # JM liveness: if the JVM died, exit so docker restart=unless-stopped revives us.
        if ! kill -0 "$JM_PID" 2>/dev/null; then
          echo ">> jobmanager JVM PID $JM_PID exited; restarting container"
          kill "$TAIL_PID" 2>/dev/null || true
          exit 1
        fi
        # Is any job live? Parse /jobs ("status" field) with grep/tr/case — the
        # flink image has NO python3. Terminal = FAILED/FINISHED/CANCELED; anything
        # else (RUNNING/RESTARTING/CREATED/RECONCILING/INITIALIZING/...) counts as
        # live, so we never double-submit during a job's own startup.
        alive=0
        for st in $(curl -s localhost:8081/jobs 2>/dev/null | grep -o '"status":"[A-Z]*"' | grep -oE '[A-Z]+'); do
          case "$st" in
            FAILED|FINISHED|CANCELED) ;;
            *) alive=1 ;;
          esac
        done
        if [ "$alive" = "1" ]; then
          # A job is running. Hold at the slow cadence — but if the flag was
          # cleared (Stop button), the webapp also cancels the job via REST, so
          # the job will go terminal and we'll fall through next pass.
          backoff=15
          sleep 15
          continue
        fi
        # No live job. Only (re)submit when armed by the webapp; otherwise idle,
        # polling fast so the button-to-stream latency stays low (~3s).
        if [ ! -f "$STREAM_FLAG" ]; then
          sleep 3
          continue
        fi
        # Armed + no live job -> (re)submit. This both starts the stream on the
        # first button press and SELF-HEALS it afterward: if the webapp's runtime
        # storage switch drops the warehouse and kills the job, the flag stays on
        # so we resubmit against the freshly-registered warehouse. sql-client.sh -f
        # exits 0 EVEN WHEN a statement fails (e.g. the warehouse is momentarily
        # absent in the DELETE/re-register window), so we DON'T trust its exit
        # code: the next loop's job-state poll is the real success signal. On
        # consecutive misses, back off (15->30->60s cap) to wait out that window.
        echo ">> armed and no live job — submitting stream.sql"
        /opt/flink/bin/sql-client.sh -f /opt/flink/sql/stream.sql || true
        sleep "$backoff"
        if [ "$backoff" -lt 60 ]; then backoff=$((backoff * 2)); [ "$backoff" -gt 60 ] && backoff=60; fi
      done
    EOT
    ,
  ]
  restart = "unless-stopped"
}

resource "docker_container" "flink_taskmanager" {
  count      = var.enable_flink ? 1 : 0
  name       = "flink-taskmanager"
  image      = docker_image.flink[0].image_id
  user       = "root"
  # Needs the jobmanager up to register; the bootstrap gate keeps ordering sane.
  depends_on = [docker_container.flink_jobmanager]
  networks_advanced { name = docker_network.lake.name }
  # Same config (finds the JM via jobmanager.rpc.address) and same jar staging —
  # the taskmanager runs the sink operator, so it needs the Iceberg jars too.
  volumes {
    host_path      = abspath("${path.module}/flink/config.yaml")
    container_path = "/opt/flink/conf/config.yaml"
    read_only      = true
  }
  command = [
    "/bin/bash", "-c",
    "${local.flink_jar_stage}\n/opt/flink/bin/taskmanager.sh start-foreground",
  ]
  restart = "unless-stopped"
}

# ----------------------------------------------------------------------------
# Webapp  (Next.js 15 — guided clickthrough of sql/demo.sql)
# Rebuilds when anything under webapp/ changes (src_hash trigger).
# ----------------------------------------------------------------------------
locals {
  webapp_all      = fileset("${path.module}/webapp", "**")
  webapp_excluded = setunion(
    fileset("${path.module}/webapp", "node_modules/**"),
    fileset("${path.module}/webapp", ".next/**"),
    fileset("${path.module}/webapp", "out/**"),
  )
  webapp_files = sort(tolist(setsubtract(local.webapp_all, local.webapp_excluded)))
  webapp_hash  = sha1(join("", [for f in local.webapp_files : filesha1("${path.module}/webapp/${f}")]))
}

resource "docker_image" "webapp" {
  name = "iceberg-v3-demo-webapp:latest"
  build {
    context    = "${path.module}/webapp"
    dockerfile = "Dockerfile"
  }
  triggers = { src_hash = local.webapp_hash }
}

resource "docker_container" "webapp" {
  name       = "demo-webapp"
  image      = docker_image.webapp.image_id
  depends_on = [docker_container.spark_thrift, null_resource.bootstrap]
  networks_advanced { name = docker_network.lake.name }
  ports {
    internal = 3000
    external = 3030
  }
  env = [
    "THRIFT_HOST=spark-thrift",
    "THRIFT_PORT=10000",
    "LAKEKEEPER_URL=http://lakekeeper:8181",
    "LAKEKEEPER_WAREHOUSE=${var.warehouse}",
    "MINIO_ENDPOINT=http://lake-minio:9000",
    "MINIO_ACCESS_KEY=${var.s3_access_key}",
    "MINIO_SECRET_KEY=${var.s3_secret_key}",
    "MINIO_BUCKET=${var.bucket}",
    "HOST_SUFFIX=${local.host_suffix}",
    "STATE_DIR=/data",
    # Lets the webapp's step-19 interop widget distinguish "Flink not deployed"
    # from "Flink up but no rows yet". Tracks the same var that gates the Flink
    # containers, so toggling enable_flink recreates the webapp with the right
    # flag.
    "FLINK_ENABLED=${var.enable_flink ? "1" : "0"}",
    # Jobmanager REST base — the step-19 Stop button cancels the running job here.
    "FLINK_URL=http://flink-jobmanager:8081",
  ]

  # Persist the chosen storage config (incl. GCS SA key) across container
  # restarts/recreations. Without this the in-memory config resets to the MinIO
  # default on every restart, silently dropping a configured GCS warehouse.
  volumes {
    host_path      = abspath("${path.module}/.demo-state")
    container_path = "/data"
  }
}
