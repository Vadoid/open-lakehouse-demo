output "lakekeeper_ui" {
  value = "http://localhost:8181/ui/  (External: http://${local.external_ip}:8181/ui/)"
}

output "lakekeeper_rest_catalog" {
  value = "http://localhost:8181/catalog  (External: http://${local.external_ip}:8181/catalog)"
}

output "minio_console" {
  value = "http://localhost:9001  (External: http://${local.external_ip}:9001)  (user: ${var.s3_access_key})"
}

output "thrift_jdbc" {
  value = "jdbc:hive2://localhost:10000  (External: jdbc:hive2://${local.external_ip}:10000)"
}

output "run_demo" {
  value = "docker exec spark-thrift /opt/spark/bin/beeline -u jdbc:hive2://localhost:10000 -f /opt/demo/demo.sql"
}

output "webapp_url" {
  value = "http://localhost:3030  (External: http://${local.external_ip}:3030)"
}

# Static strings — printed always with an "(if Flink enabled)" note rather than
# indexing docker_container.flink_jobmanager[0], which would be an index error
# on the default count=0 (Spark-only) path and break `terraform output`.
output "flink_ui" {
  value = "http://localhost:8081  (External: http://${local.external_ip}:8081)  (if Flink enabled)"
}

output "flink_interop_check" {
  value = "docker exec spark-thrift /opt/spark/bin/beeline -u jdbc:hive2://localhost:10000 -e \"SELECT count(*) FROM demo.market.trades_stream;\"  (run twice ~10s apart; count climbs — if Flink enabled)"
}
