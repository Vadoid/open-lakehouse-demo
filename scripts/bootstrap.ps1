# Creates the MinIO bucket, bootstraps Lakekeeper, and registers the warehouse.
# Windows counterpart to bootstrap.sh, invoked by Terraform's local-exec.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$lk = 'http://localhost:8181'

function Invoke-Retry([scriptblock]$Action, [int]$Attempts, [int]$DelaySeconds) {
    for ($i = 0; $i -lt $Attempts; $i++) {
        try { return (& $Action) } catch {
            if ($i -eq $Attempts - 1) { throw }
            Start-Sleep -Seconds $DelaySeconds
        }
    }
}

Write-Host '>> waiting for Lakekeeper to be healthy...'
Invoke-Retry { Invoke-RestMethod -Uri "$lk/health" -TimeoutSec 5 | Out-Null } 60 2

Write-Host ">> creating MinIO bucket '$env:BUCKET'..."
$net = (& docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' lake-minio 2>$null | Select-Object -First 1)
if (-not $net) { $net = $env:NETWORK }
if (-not $net) { throw 'Could not determine the Docker network attached to lake-minio.' }
& docker network inspect $net *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker network '$net' is unavailable to this Docker CLI. Check the active Docker context." }
Write-Host ">> using network '$net'"
$mcHost = "http://$($env:S3_ACCESS_KEY):$($env:S3_SECRET_KEY)@lake-minio:9000"
& docker run --rm --network $net `
    -e "MC_HOST_lake=$mcHost" `
    --entrypoint mc `
    cgr.dev/chainguard/minio-client:latest `
    mb --ignore-existing "lake/$($env:BUCKET)"
if ($LASTEXITCODE -ne 0) { throw 'MinIO bucket creation failed.' }

Write-Host '>> bootstrapping Lakekeeper (sets initial admin / first project)...'
try {
    Invoke-RestMethod -Method Post -Uri "$lk/management/v1/bootstrap" -ContentType 'application/json' -Body '{"accept-terms-of-use": true}' | Out-Null
} catch { Write-Host '   (already bootstrapped, continuing)' }

Write-Host ">> creating warehouse '$env:WAREHOUSE' on MinIO..."
$warehouse = @{
    'warehouse-name' = $env:WAREHOUSE
    'storage-profile' = @{
        type = 's3'; bucket = $env:BUCKET; 'key-prefix' = 'demo'
        endpoint = 'http://lake-minio:9000'; region = 'us-east-1'
        'path-style-access' = $true; flavor = 's3-compat'; 'sts-enabled' = $false
    }
    'storage-credential' = @{
        type = 's3'; 'credential-type' = 'access-key'
        'aws-access-key-id' = $env:S3_ACCESS_KEY
        'aws-secret-access-key' = $env:S3_SECRET_KEY
    }
} | ConvertTo-Json -Depth 8
try {
    Invoke-RestMethod -Method Post -Uri "$lk/management/v1/warehouse" -ContentType 'application/json' -Body $warehouse | Out-Null
} catch { Write-Host '   (warehouse may already exist, continuing)' }

Write-Host ">> creating 'default' namespace in warehouse '$env:WAREHOUSE'..."
$configUri = "$lk/catalog/v1/config?warehouse=$([uri]::EscapeDataString($env:WAREHOUSE))"
$config = Invoke-Retry {
    $response = Invoke-RestMethod -Uri $configUri -Headers @{ Authorization = 'Bearer dummy' } -TimeoutSec 10
    $prefix = $response.defaults.prefix
    if (-not $prefix) { $prefix = $response.overrides.prefix }
    if (-not $prefix) { throw 'Warehouse prefix not present in response yet.' }
    $prefix
} 30 2
Write-Host ">> warehouse prefix: $config"
$namespace = '{"namespace":["default"]}'
try {
    Invoke-RestMethod -Method Post -Uri "$lk/catalog/v1/$config/namespaces" -Headers @{ Authorization = 'Bearer dummy' } -ContentType 'application/json' -Body $namespace | Out-Null
} catch { Write-Host '   (namespace may already exist, continuing)' }

Write-Host '>> bootstrap complete.'
