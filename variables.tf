variable "lakekeeper_version" {
  description = "Lakekeeper catalog image tag on quay.io"
  type        = string
  default     = "v0.13.1"
}

variable "pg_user" {
  type    = string
  default = "postgres"
}

variable "pg_password" {
  type    = string
  default = "postgres"
}

variable "s3_access_key" {
  type    = string
  default = "minio-admin"
}

variable "s3_secret_key" {
  type    = string
  default = "minio-admin-password"
}

variable "bucket" {
  description = "MinIO bucket that backs the warehouse"
  type        = string
  default     = "warehouse"
}

variable "warehouse" {
  description = "Lakekeeper warehouse name (referenced by Spark as the catalog warehouse)"
  type        = string
  default     = "demo"
}

# Second engine, ON by default. Stands up a Flink 1.20 session cluster
# (jobmanager + taskmanager) that streams synthetic trades into the SAME
# Lakekeeper catalog + object store Spark uses. Additive — Spark Thrift and the
# batch demo are unaffected. Set false (deploy.sh offers a Spark-only opt-out, or
# pass -var enable_flink=false) on a low-RAM host that can't spare the +3-4 GiB.
variable "enable_flink" {
  description = "Run the Flink streaming engine (jobmanager + taskmanager). On by default; set false for a Spark-only stack."
  type        = bool
  default     = true
}

# ADDITIVE OPTIONAL INTEGRATION: Jupyter runs as a separate container on the
# existing Docker network. Disabled by default; does not change core services.
variable "enable_jupyter" {
  description = "Run an optional JupyterLab container on the lakehouse network."
  type        = bool
  default     = false
}

# Terraform is also used by the PowerShell launcher on native Windows. Convert
# Windows paths to Docker Desktop's shared-drive form for bind mounts.
variable "os_family" {
  description = "Host OS running Terraform (windows or unix)"
  type        = string
  default     = "unix"
}
