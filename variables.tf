variable "lakekeeper_version" {
  description = "Lakekeeper catalog image tag on quay.io"
  type        = string
  default     = "v0.12.0"
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

# Optional second engine. When true, deploy.sh stands up a Flink 1.20 session
# cluster (jobmanager + taskmanager) that streams synthetic trades into the SAME
# Lakekeeper catalog + MinIO bucket Spark uses. Additive only — Spark Thrift and
# the batch demo are unaffected. Set by deploy.sh's interactive engine menu
# (-var enable_flink=...), default off so the Spark-only path is unchanged.
variable "enable_flink" {
  description = "Add an optional Flink streaming engine (jobmanager + taskmanager)"
  type        = bool
  default     = false
}
