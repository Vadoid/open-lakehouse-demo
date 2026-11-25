# Deploy Spark + Flink (prompts for engine choice when interactive)
.\deploy.ps1

# Deploy Spark only
.\deploy.ps1 -SparkOnly

# Deploy and run the full SQL demo
.\deploy.ps1 -RunDemo

# Skip the container DNS check
.\deploy.ps1 -SkipNetCheck

# Combine options
.\deploy.ps1 -SparkOnly -RunDemo
.\deploy.ps1 -SkipNetCheck -RunDemo

# To remove the stack:
# .\destroy.ps1

# To recreate all containers:
# .\destroy.ps1
# .\deploy.ps1

# Container status and published ports
docker ps -a --filter network=lakedemo --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"

# Check the main HTTP endpoints
3030, 8081, 8181, 9000, 9001 | ForEach-Object {
    $port = $_
    try {
        $response = Invoke-WebRequest "http://localhost:$port" -TimeoutSec 5 -UseBasicParsing
        "$port : HTTP $($response.StatusCode)"
    } catch {
        "$port : $($_.Exception.Message)"
    }
}

# Flink cluster status
Invoke-RestMethod http://localhost:8081/overview | Format-List

# Spark Thrift JDBC check
docker exec spark-thrift /opt/spark/bin/beeline `
    -u jdbc:hive2://localhost:10000 `
    -e "SELECT 1"

# Optional: check Flink streaming after starting it from the webapp's step 19
docker exec spark-thrift /opt/spark/bin/beeline `
    -u jdbc:hive2://localhost:10000 `
    -e "SELECT count(*) FROM demo.market.trades_stream;"

