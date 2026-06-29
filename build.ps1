param (
    [string[]]$Targets = @(
        "windows/amd64",
        "windows/arm64",
        "linux/amd64",
        "linux/arm64",
        "darwin/amd64",
        "darwin/arm64"
    ),
    [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host "Starting WebSSH Build Process..." -ForegroundColor Cyan

if (-not $SkipFrontend) {
    # 1. Build WASM
    Write-Host "=> Building WASM..." -ForegroundColor Yellow
    Set-Location (Join-Path $ProjectRoot "frontend/wasm")
    $env:GOOS = "js"
    $env:GOARCH = "wasm"
    go build -o ../public/main.wasm .
    if ($LASTEXITCODE -ne 0) { throw "WASM build failed" }
    Write-Host "   WASM built successfully." -ForegroundColor Green

    # 2. Build Frontend
    Write-Host "=> Building Frontend..." -ForegroundColor Yellow
    Set-Location (Join-Path $ProjectRoot "frontend")
    # Uncomment next line if you want npm ci to run every time
    # npm ci
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
    Write-Host "   Frontend built successfully." -ForegroundColor Green
}

# 3. Prepare Static Files for Backend
Write-Host "=> Preparing static files for backend embedding..." -ForegroundColor Yellow
Set-Location $ProjectRoot
$StaticDir = Join-Path $ProjectRoot "backend/internal/staticfs/static"
if (Test-Path $StaticDir) {
    Remove-Item -Recurse -Force $StaticDir
}
Copy-Item -Recurse -Force (Join-Path $ProjectRoot "frontend/dist") $StaticDir
Write-Host "   Static files copied." -ForegroundColor Green

# 4. Build Backend
Write-Host "=> Building Backend for targets..." -ForegroundColor Yellow
Set-Location (Join-Path $ProjectRoot "backend")
$env:CGO_ENABLED = "0"

# Create output directory if not exists
$OutDir = Join-Path $ProjectRoot "build"
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
}

foreach ($Target in $Targets) {
    $parts = $Target.Split('/')
    $os = $parts[0]
    $arch = $parts[1]
    
    $env:GOOS = $os
    $env:GOARCH = $arch
    
    $ext = if ($os -eq "windows") { ".exe" } else { "" }
    $binaryName = "webssh-${os}-${arch}${ext}"
    $outputPath = Join-Path $OutDir $binaryName
    
    Write-Host "   Compiling $Target -> $binaryName ..."
    go build -ldflags="-s -w" -o $outputPath ./cmd/server
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build for $Target"
    } else {
        Write-Host "   [OK] $binaryName" -ForegroundColor Green
    }
}

Set-Location $ProjectRoot
Write-Host "Build complete! Check the 'build' directory." -ForegroundColor Cyan
