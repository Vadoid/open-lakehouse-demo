[CmdletBinding()]
param(
    [switch]$CleanupGcs,
    [switch]$KeepDemoState
)
$ErrorActionPreference = 'Continue'
$env:TF_VAR_os_family = 'windows'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

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

if ((Test-Path .terraform) -or (Test-Path terraform.tfstate)) {
    if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {
        Write-Warning 'Terraform is not on PATH; skipping Terraform destroy and continuing with Docker cleanup.'
    } else {
    Write-Host '>> terraform destroy'
    & terraform destroy -auto-approve -input=false
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Terraform destroy returned non-zero; continuing with Docker cleanup.' }
    }
} else { Write-Host '>> no Terraform state here; skipping terraform destroy' }

$containers = @('lake-postgres','lake-minio','lakekeeper','lake-migrate','spark-thrift','demo-webapp','flink-jobmanager','flink-taskmanager')
$dockerAvailable = $false
& docker info *> $null
if ($LASTEXITCODE -eq 0) {
    $dockerAvailable = $true
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
