[CmdletBinding()]
param(
    [switch]$SparkOnly,
    [switch]$RunDemo,
    [switch]$SkipNetCheck,
    [switch]$All,
    # ADDITIVE OPTIONAL INTEGRATION — deploy Superset in its own Compose project.
    [switch]$Superset,
    # ADDITIVE OPTIONAL INTEGRATION — opt in to the separate JupyterLab container.
    [switch]$Jupyter,
    [ValidateSet('Token', 'Password')]
    [string]$JupyterAuth = 'Token',
    # Accept GNU-style --all and --superset aliases for PowerShell users.
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExtraArgs
)
$ErrorActionPreference = 'Stop'
$env:TF_VAR_os_family = 'windows'
$ProgressPreference = 'SilentlyContinue'
Set-Location $PSScriptRoot

if ($ExtraArgs) {
    $unsupportedArgs = @($ExtraArgs | Where-Object { $_ -ine '--all' -and $_ -ine '--superset' })
    if ($unsupportedArgs.Count -gt 0) {
        throw "Unknown argument(s): $($unsupportedArgs -join ', '). Use -All/--all or -Superset/--superset."
    }
    if ($ExtraArgs -icontains '--all') { $All = $true }
    if ($ExtraArgs -icontains '--superset') { $Superset = $true }
}

if ($All -and $SparkOnly) { throw '-All includes Flink; do not combine -All with -SparkOnly.' }
if ($All) { $Jupyter = $true; $Superset = $true }
if ($JupyterAuth -eq 'Password') { $Jupyter = $true }

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

function Wait-HttpEndpoint([string]$Name, [string]$Uri, [int]$Attempts = 60) {
    Write-Host -NoNewline ">> waiting for $Name"
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            $null = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3
            Write-Host ' ready'
            return
        } catch {
            Write-Host -NoNewline '.'
            Start-Sleep -Seconds 2
        }
    }
    Write-Host ''
    throw "$Name did not become ready at $Uri. Check Docker logs and the service status."
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

$enableFlink = $All -or -not $SparkOnly
if (-not $SparkOnly -and -not $All -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
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
if ($Jupyter -and $JupyterAuth -eq 'Password') {
    Write-Host 'Set the JupyterLab password (input is hidden).'
    $passwordHash = @(& docker run --rm -it --entrypoint python quay.io/jupyter/minimal-notebook:latest -c 'from getpass import getpass; from jupyter_server.auth.security import passwd; print(passwd(getpass()))')
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the Jupyter password hash.' }
    $passwordHash = (($passwordHash | Select-Object -Last 1).ToString()).Trim()
    if (-not $passwordHash.StartsWith('argon2:')) { throw 'Jupyter did not return a valid Argon2 password hash.' }
    $env:TF_VAR_jupyter_password_hash = $passwordHash
} else {
    # The explicit Token choice clears a stale hash from this PowerShell session.
    Remove-Item Env:TF_VAR_jupyter_password_hash -ErrorAction SilentlyContinue
}
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
    if ($JupyterAuth -eq 'Password') {
        Write-Host 'JupyterLab password authentication is enabled.'
    } else {
        Write-Host 'Retrieve its generated login token with: docker logs lake-jupyter'
    }
}

# ADDITIVE OPTIONAL INTEGRATION — Superset has its own Compose project and
# joins lakedemo only after Terraform has created the core network.
if ($Superset) {
    $supersetCompose = Join-Path $PSScriptRoot 'superset\compose.yaml'
    if (-not (Test-Path -LiteralPath $supersetCompose -PathType Leaf)) { throw "Required Compose file not found: $supersetCompose" }
    Write-Host '>> starting optional Apache Superset'
    & docker compose -p superset -f $supersetCompose up -d --build
    if ($LASTEXITCODE -ne 0) {
        $supersetExitCode = $LASTEXITCODE
        Write-Host 'Recent Superset initializer logs:'
        & docker logs --tail 100 superset-init
        throw "Superset Compose startup failed with exit code $supersetExitCode."
    }
    Wait-HttpEndpoint 'Apache Superset' 'http://127.0.0.1:8088/health' 120
    Write-Host 'Apache Superset: http://localhost:8088'
}

# ADDITIVE OPTIONAL INTEGRATIONS — -All starts the independent MLflow and
# portal Compose projects only after Terraform has created the lakedemo network.
if ($All) {
    $mlflowCompose = Join-Path $PSScriptRoot 'mlflow\compose.yaml'
    $portalCompose = Join-Path $PSScriptRoot 'portal\compose.yaml'
    foreach ($composeFile in @($mlflowCompose, $portalCompose)) {
        if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) { throw "Required Compose file not found: $composeFile" }
    }

    Write-Host '>> starting optional MLflow Tracking Server and Model Registry'
    Invoke-Native docker @('compose', '-p', 'mlflow', '-f', $mlflowCompose, 'up', '-d')
    Wait-HttpEndpoint 'MLflow' 'http://127.0.0.1:5000/health' 60

    Write-Host '>> starting standalone Open Lakehouse portal'
    Invoke-Native docker @('compose', '-p', 'open-lakehouse-portal', '-f', $portalCompose, 'up', '-d')
    Wait-HttpEndpoint 'Open Lakehouse portal' 'http://127.0.0.1:3050/' 30

    Write-Host 'MLflow UI: http://localhost:5000'
    Write-Host 'Open Lakehouse portal: http://127.0.0.1:3050'
}

Write-Host "`nStack is up. Endpoints:"
Invoke-Native terraform @('output')
Write-Host 'Webapp: http://localhost:3030'
