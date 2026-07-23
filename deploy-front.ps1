[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$FrontendUrl = 'http://localhost:8080'
$ComposeFiles = @(
    '-f', 'docker-compose.windows.yml'
)

function Assert-LastCommandSucceeded {
    param([Parameter(Mandatory)][string]$Message)

    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

function Test-DockerEngine {
    $PreviousErrorActionPreference = $ErrorActionPreference

    try {
        $ErrorActionPreference = 'SilentlyContinue'
        & docker info 2> $null | Out-Null
        return $LASTEXITCODE -eq 0
    }
    catch {
        return $false
    }
    finally {
        $ErrorActionPreference = $PreviousErrorActionPreference
    }
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerEngine) {
        return
    }

    Write-Host 'Docker Desktop no esta iniciado. Arrancandolo...' -ForegroundColor Yellow

    $DockerDesktopProcess = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue

    if (-not $DockerDesktopProcess) {
        $DockerDesktopCandidates = @(
            "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
            "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
            "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
        )

        $DockerDesktopExecutable = $DockerDesktopCandidates |
            Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } |
            Select-Object -First 1

        if (-not $DockerDesktopExecutable) {
            throw 'No se encontro Docker Desktop. Abrelo manualmente y vuelve a ejecutar el script.'
        }

        Start-Process -FilePath $DockerDesktopExecutable
    }

    $StartupDeadline = (Get-Date).AddMinutes(2)

    do {
        Start-Sleep -Seconds 3

        if (Test-DockerEngine) {
            Write-Host 'Docker Desktop esta listo.' -ForegroundColor Green
            return
        }
    } while ((Get-Date) -lt $StartupDeadline)

    throw 'Docker Desktop no estuvo listo tras 2 minutos. Comprueba su ventana y vuelve a intentarlo.'
}

if (-not $PSScriptRoot) {
    throw 'No se ha podido determinar la carpeta del script.'
}

Set-Location -LiteralPath $PSScriptRoot

foreach ($RequiredFile in @('docker-compose.windows.yml', 'Dockerfile', 'nginx.conf')) {
    if (-not (Test-Path -LiteralPath $RequiredFile -PathType Leaf)) {
        throw "No se encuentra $RequiredFile en $PSScriptRoot."
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git no esta instalado o no esta disponible en PATH.'
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker no esta instalado o Docker Desktop no esta disponible en PATH.'
}

& docker compose version *> $null
Assert-LastCommandSucceeded 'Docker Compose no esta disponible. Comprueba la instalacion de Docker Desktop.'

Start-DockerDesktopIfNeeded

Write-Host 'Actualizando el repositorio...' -ForegroundColor Cyan
& git pull --ff-only
Assert-LastCommandSucceeded 'No se pudo actualizar el repositorio.'

Write-Host 'Validando la configuracion de Docker Compose...' -ForegroundColor Cyan
& docker compose @ComposeFiles config --quiet
Assert-LastCommandSucceeded 'La configuracion de Docker Compose no es valida.'

Write-Host 'Construyendo y desplegando el frontend...' -ForegroundColor Cyan
& docker compose @ComposeFiles up -d --build
Assert-LastCommandSucceeded 'No se pudo construir o iniciar el frontend.'

Write-Host "`nEstado del servicio:" -ForegroundColor Cyan
& docker compose @ComposeFiles ps
Assert-LastCommandSucceeded 'No se pudo consultar el estado del servicio.'

Write-Host "`nUltimas 30 lineas del log:" -ForegroundColor Cyan
& docker compose @ComposeFiles logs --tail=30 agroiris
Assert-LastCommandSucceeded 'No se pudieron consultar los logs del frontend.'

Write-Host "`nComprobando que el frontend responde..." -ForegroundColor Cyan
$FrontendReady = $false

for ($Attempt = 1; $Attempt -le 20; $Attempt++) {
    try {
        $Response = Invoke-WebRequest -Uri $FrontendUrl -UseBasicParsing -TimeoutSec 2

        if ($Response.StatusCode -eq 200) {
            $FrontendReady = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $FrontendReady) {
    throw "El contenedor esta iniciado, pero el frontend no responde en $FrontendUrl."
}

Write-Host "`nFrontend listo para pruebas: $FrontendUrl" -ForegroundColor Green
