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
  ]
}
