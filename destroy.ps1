[CmdletBinding()]
param(
    # Explicit full-stack teardown alias. The default destroy already removes
    # all known core and optional containers while preserving add-on data volumes.
    [switch]$All,
    [switch]$CleanupGcs,
    [switch]$KeepDemoState
)
$ErrorActionPreference = 'Continue'
$env:TF_VAR_os_family = 'windows'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

if ($All) { Write-Host '>> -All selected — removing core and optional service containers.' }
# Authentication is only needed while deploying Jupyter. An inherited stale
# or malformed hash can otherwise fail Terraform's variable validation during
# destroy, even though teardown never reads the credential.
Remove-Item Env:TF_VAR_jupyter_password_hash -ErrorAction SilentlyContinue

# Windows PowerShell 5.1 always surfaces native stderr as an error record;
# PowerShell 7 can be configured to do the same. Cleanup probes rely on exit
# codes, so keep Docker CLI diagnostics from interrupting best-effort teardown.
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

$gcsBucket = $null
$isCustomBucket = $null
$hostSuffix = $null
$projectId = $null
try {
    $storage = Invoke-RestMethod -Uri 'http://localhost:3030/api/storage-setup' -TimeoutSec 3
    if ($storage.type -eq 'gcs') {
        $gcsBucket = $storage.bucket; $isCustomBucket = $storage.isCustomBucket
        $hostSuffix = $storage.hostSuffix; $projectId = $storage.projectId
    }
} catch { }

# MLflow is an independent Compose add-on, but its server attaches to the
# Terraform-managed lakedemo network. Stop that project before destroying the
# network; Compose down preserves its named PostgreSQL and artifact volumes.
$dockerAvailable = $false
& docker info *> $null
if ($LASTEXITCODE -eq 0) {
    $dockerAvailable = $true
    & docker inspect mlflow *> $null
    $mlflowServerExists = $LASTEXITCODE -eq 0
    & docker inspect mlflow-db *> $null
    $mlflowDatabaseExists = $LASTEXITCODE -eq 0
    if ($mlflowServerExists -or $mlflowDatabaseExists) {
        $mlflowCompose = Join-Path $PSScriptRoot 'mlflow\compose.yaml'
        if (Test-Path -LiteralPath $mlflowCompose) {
            Write-Host '>> stopping optional MLflow add-on (keeping its data volumes)'
            & docker compose -p mlflow -f $mlflowCompose down
            if ($LASTEXITCODE -ne 0) {
                Write-Warning 'Could not stop the MLflow Compose project; its container may keep lakedemo attached.'
            }
        }
    }
    & docker inspect superset *> $null
    $supersetAppExists = $LASTEXITCODE -eq 0
    & docker inspect superset-db *> $null
    $supersetDbExists = $LASTEXITCODE -eq 0
    & docker inspect superset-init *> $null
    $supersetInitExists = $LASTEXITCODE -eq 0
    if ($supersetAppExists -or $supersetDbExists -or $supersetInitExists) {
        $supersetCompose = Join-Path $PSScriptRoot 'superset\compose.yaml'
        if (Test-Path -LiteralPath $supersetCompose) {
            Write-Host '>> stopping optional Apache Superset (keeping its data volumes)'
            & docker compose -p superset -f $supersetCompose down
            if ($LASTEXITCODE -ne 0) {
                Write-Warning 'Could not stop Superset; its container may keep lakedemo attached.'
            }
        }
    }
    & docker inspect open-lakehouse-portal *> $null
    if ($LASTEXITCODE -eq 0) {
        $portalCompose = Join-Path $PSScriptRoot 'portal\compose.yaml'
        if (Test-Path -LiteralPath $portalCompose) {
            Write-Host '>> stopping standalone portal before removing lakedemo'
            & docker compose -p open-lakehouse-portal -f $portalCompose down
            if ($LASTEXITCODE -ne 0) {
                Write-Warning 'Could not stop the portal Compose project; its container may keep lakedemo attached.'
            }
        }
    }
}

if ((Test-Path .terraform) -or (Test-Path terraform.tfstate)) {
    if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
        Write-Warning 'Terraform is not on PATH; skipping Terraform destroy and continuing with Docker cleanup.'
    } else {
    Write-Host '>> terraform destroy'
    & terraform destroy -auto-approve -input=false
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Terraform destroy returned non-zero; continuing with Docker cleanup.' }
    }
} else { Write-Host '>> no Terraform state here; skipping terraform destroy' }

$containers = @('lake-postgres','lake-minio','lakekeeper','lake-migrate','spark-thrift','demo-webapp','flink-jobmanager','flink-taskmanager','lake-jupyter','mlflow','mlflow-db','superset','superset-db','superset-init','open-lakehouse-portal')
if ($dockerAvailable) {
    $existingContainers = @(& docker ps -a --format '{{.Names}}' 2>$null)
    foreach ($container in $containers) {
        if ($existingContainers -contains $container) {
            Write-Host ">> removing container $container"
            & docker rm -f $container *> $null
            if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove container '$container'." }
        }
    }
    $networks = @(& docker network ls --format '{{.Name}}' 2>$null)
    if ($networks -contains 'lakedemo') {
        Write-Host '>> removing network lakedemo'
        & docker network rm lakedemo
        if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not remove lakedemo; another container may still be attached.' }
    }
} else {
    Write-Warning 'Docker Desktop is unavailable; skipped container and network cleanup.'
}

if (-not $KeepDemoState -and (Test-Path .demo-state)) {
    Write-Host '>> removing local persisted state (.demo-state)'
    Remove-Item -LiteralPath .demo-state -Recurse -Force
} elseif ($KeepDemoState) {
    Write-Host '>> keeping local persisted state (.demo-state)'
}

$saEmail = if ($projectId -and $hostSuffix) { "lakehouse-catalog-$hostSuffix@$projectId.iam.gserviceaccount.com" } else { $null }
if ($gcsBucket -or $saEmail) {
    if ($CleanupGcs -or $env:CLEANUP_GCS -eq '1') {
        if ($gcsBucket -and $isCustomBucket -eq $false) {
            if (Get-Command gcloud -ErrorAction SilentlyContinue) {
                & gcloud storage rm --recursive "gs://$gcsBucket/**" --quiet
                & gcloud storage buckets delete "gs://$gcsBucket" --quiet
                if ($LASTEXITCODE -ne 0) { Write-Warning "Could not delete generated bucket gs://$gcsBucket." }
            } else { Write-Warning 'gcloud is not on PATH; leaving the generated bucket in place.' }
        } elseif ($gcsBucket) { Write-Host " >> keeping custom GCS bucket gs://$gcsBucket" }
        if ($saEmail) {
            if (Get-Command gcloud -ErrorAction SilentlyContinue) {
                & gcloud iam service-accounts delete $saEmail "--project=$projectId" --quiet
                if ($LASTEXITCODE -ne 0) { Write-Warning "Could not delete service account $saEmail." }
            } else { Write-Warning 'gcloud is not on PATH; leaving the generated service account in place.' }
        }
    } else { Write-Host '>> leaving GCS sandbox resources in place (pass -CleanupGcs to delete eligible resources)' }
}
if ($dockerAvailable) { Write-Host "`nTeardown complete. Check remaining containers with: docker ps -a" }
else { Write-Host "`nLocal teardown actions are complete; start Docker Desktop and rerun destroy.ps1 to remove containers/network." }
