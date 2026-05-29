output "lakekeeper_ui" {
  value = "http://localhost:8181/ui/"
}

output "lakekeeper_rest_catalog" {
  value = "http://localhost:8181/catalog"
}

output "minio_console" {
  value = "http://localhost:9001  (user: ${var.s3_access_key})"
}

output "thrift_jdbc" {
  value = "jdbc:hive2://localhost:10000"
}

output "run_demo" {
  value = "docker exec spark-thrift /opt/spark/bin/beeline -u jdbc:hive2://localhost:10000 -f /opt/demo/demo.sql"
}

output "webapp_url" {
  value = "http://localhost:3030"
}
