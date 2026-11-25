[CmdletBinding()]
param(
    [switch]$SparkOnly,
    [switch]$RunDemo,
    [switch]$SkipNetCheck,
    # ADDITIVE OPTIONAL INTEGRATION — opt in to the separate JupyterLab container.
    [switch]$Jupyter
)
$ErrorActionPreference = 'Stop'
$env:TF_VAR_os_family = 'windows'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

# PowerShell 7 can promote native stderr to terminating ErrorRecords. Docker
# writes connection failures there, so disable that behavior for readiness
# probes and handle failures through LASTEXITCODE instead.
if (Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Invoke-Native([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}

foreach ($tool in @('docker', 'terraform')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Required command '$tool' was not found on PATH. Install Docker Desktop and Terraform >= 1.5." }
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host '>> Docker Desktop daemon is not running; attempting to launch Docker Desktop'
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (-not (Test-Path $desktop)) { throw 'Docker Desktop is not installed. Start Docker Desktop, then rerun deploy.ps1.' }
    Start-Process -FilePath $desktop -WindowStyle Hidden
    Write-Host -NoNewline '>> waiting for Docker Desktop'
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 2
    }
    Write-Host ''
    if (-not $ready) { throw 'Docker Desktop did not become ready within 120 seconds. Open Docker Desktop, wait for the engine to report Running, and confirm it is using Linux containers, then rerun .\deploy.ps1.' }
}

# Terraform's Docker provider uses DOCKER_HOST, while the CLI can use a context.
if (-not $env:DOCKER_HOST) {
    $contextHost = docker context inspect -f '{{ .Endpoints.docker.Host }}' 2>$null | Select-Object -First 1
    if ($contextHost) { $env:DOCKER_HOST = $contextHost; Write-Host ">> DOCKER_HOST=$contextHost (from active Docker context)" }
}

$enableFlink = -not $SparkOnly
if (-not $SparkOnly -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    Write-Host "`nEngine selection`n  1) Spark + Flink streaming (default)`n  2) Spark only"
    $choice = Read-Host 'Pick [1/2]'
    if ($choice -eq '2') { $enableFlink = $false }
}
if ($enableFlink) { Write-Host '>> Spark + Flink streaming enabled' } else { Write-Host '>> Spark only' }

if (-not ($SkipNetCheck -or $env:SKIP_NET_CHECK -eq '1')) {
    Write-Host '>> checking container internet (DNS to registry.npmjs.org)'
    & docker pull -q busybox:1.36 *> $null
    & docker run --rm busybox:1.36 timeout 10 nslookup registry.npmjs.org *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Container DNS preflight failed. Check Docker Desktop > Settings > Resources > Network / Docker Engine DNS, or rerun with -SkipNetCheck when using pre-pulled images.' }
} else { Write-Host '>> skipping container internet preflight' }

$image = 'iceberg-v3-demo-webapp:latest'
Write-Host ">> building webapp image ($image)"
$env:DOCKER_BUILDKIT = '1'
& docker build -t $image webapp
if ($LASTEXITCODE -ne 0) {
    Write-Host '!! BuildKit build failed; retrying with the classic builder'
    $env:DOCKER_BUILDKIT = '0'
    Invoke-Native docker @('build', '-t', $image, 'webapp')
}

Write-Host '>> terraform init (reconcile local providers with the lock file)'
Invoke-Native terraform @('init', '-input=false')
# Docker bind mounts require each source to exist with the expected file/directory
# type. In particular Docker can create a missing file source as a directory.
$null = New-Item -ItemType Directory -Path (Join-Path $PSScriptRoot '.demo-state') -Force
$mountSources = @(
    @{ Path = 'spark/spark-defaults.conf'; Directory = $false },
    @{ Path = 'sql'; Directory = $true },
    @{ Path = 'flink/config.yaml'; Directory = $false },
    @{ Path = 'flink/sql'; Directory = $true },
    # ADDITIVE OPTIONAL INTEGRATION — persistent notebooks workspace.
    @{ Path = 'notebooks'; Directory = $true }
)
foreach ($source in $mountSources) {
    $sourcePath = Join-Path $PSScriptRoot $source.Path
    if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Required Docker bind mount source is missing: $sourcePath" }
    $isDirectory = (Get-Item -LiteralPath $sourcePath).PSIsContainer
    if ($isDirectory -ne $source.Directory) { throw "Docker bind mount source has the wrong type (expected $(if ($source.Directory) {'directory'} else {'file'})): $sourcePath" }
    Write-Host ">> bind mount source: $((Resolve-Path -LiteralPath $sourcePath).Path)"
}
$networkId = $null
$networkNames = @(& docker network ls --format '{{.Name}}' 2>$null)
if ($networkNames -contains 'lakedemo') {
    $networkId = (& docker network inspect lakedemo -f '{{.Id}}' 2>$null | Select-Object -First 1)
}
$stateResources = @()
if (Test-Path terraform.tfstate) {
    $stateResources = @(& terraform state list 2>$null)
}
if ($networkId -and ($stateResources -notcontains 'docker_network.lake')) {
    Write-Host '>> importing existing lakedemo network into Terraform state'
    & terraform import -input=false docker_network.lake $networkId
    if ($LASTEXITCODE -ne 0) { Write-Host '>> import failed; removing untracked network so Terraform can recreate it'; Invoke-Native docker @('network', 'rm', 'lakedemo') }
}
$flinkValue = if ($enableFlink) { 'true' } else { 'false' }
$jupyterValue = if ($Jupyter) { 'true' } else { 'false' }
Write-Host ">> terraform apply (enable_flink=$flinkValue)"
Invoke-Native terraform @('apply', '-auto-approve', '-input=false', '-var', "enable_flink=$flinkValue", '-var', "enable_jupyter=$jupyterValue")

Write-Host -NoNewline '>> waiting for Spark Thrift Server'
$thriftReady = $false
for ($i = 0; $i -lt 120; $i++) {
    # Probe the published endpoint from Windows. Container-level docker exec
    # has a race with Spark's restart policy and can terminate Windows PowerShell
    # 5.1 when Docker writes its normal "container is restarting" stderr.
    $client = $null
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $connect = $client.BeginConnect('127.0.0.1', 10000, $null, $null)
        if ($connect.AsyncWaitHandle.WaitOne(1000) -and $client.Connected) {
            $client.EndConnect($connect)
            $thriftReady = $true
            break
        }
    } catch { } finally { if ($client) { $client.Dispose() } }
    Write-Host -NoNewline '.'; Start-Sleep -Seconds 3
}
Write-Host ''
if (-not $thriftReady) {
    Write-Host 'Spark container state:'
    & docker ps -a --filter name=spark-thrift --format 'table {{.Names}}\t{{.Status}}'
    Write-Host 'Recent Spark logs:'
    & docker logs --tail 80 spark-thrift
    throw 'Thrift Server did not become ready within 6 minutes. Review the Spark logs above.'
}

if ($RunDemo -or $env:RUN_DEMO -eq '1') {
    Write-Host '>> running sql/demo.sql'
    Invoke-Native docker @('exec', 'spark-thrift', '/opt/spark/bin/beeline', '-u', 'jdbc:hive2://localhost:10000', '-f', '/opt/demo/demo.sql')
} else { Write-Host '>> stack is empty; run steps from the webapp. Use -RunDemo to execute sql/demo.sql.' }

if ($enableFlink) {
    Write-Host -NoNewline '>> waiting for Flink taskmanager'
    $flinkReady = $false
    $flinkTimer = [System.Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt 100; $i++) {
        try {
            $overview = Invoke-RestMethod -Uri 'http://localhost:8081/overview' -TimeoutSec 3
            $taskmanagerCount = [int]$overview.taskmanagers
            if ($taskmanagerCount -ge 1) { $flinkReady = $true; break }
        } catch { }
        if (($i + 1) % 10 -eq 0) { Write-Host -NoNewline " $([int]$flinkTimer.Elapsed.TotalSeconds)s" }
        else { Write-Host -NoNewline '.' }
        Start-Sleep -Seconds 3
    }
    $flinkTimer.Stop()
    Write-Host ''
    if (-not $flinkReady) {
        Write-Host 'Flink container status:'
        & docker ps -a --filter name=flink --format 'table {{.Names}}\t{{.Status}}'
        Write-Host 'Recent Flink jobmanager logs:'
        & docker logs --tail 80 flink-jobmanager
        throw 'Flink did not register a taskmanager within 5 minutes. Review the Flink logs above.'
    }
    Write-Host 'Flink is up and idle. Start streaming from the webapp bonus step (step 19). Flink UI: http://localhost:8081'
}

# ADDITIVE OPTIONAL INTEGRATION — report the local JupyterLab URL when opted in.
if ($Jupyter) {
    Write-Host 'JupyterLab is available at http://localhost:8888/lab'
    Write-Host 'Retrieve its generated login token with: docker logs lake-jupyter'
}

Write-Host "`nStack is up. Endpoints:"
Invoke-Native terraform @('output')
Write-Host 'Webapp: http://localhost:3030'
