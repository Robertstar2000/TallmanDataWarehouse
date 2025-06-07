# Launch-App.ps1 - Launches the application with elevated permissions

# Get the directory where this script is located
$scriptPath = $MyInvocation.MyCommand.Definition
$scriptDir = Split-Path -Parent $scriptPath
$projectRoot = Resolve-Path "$scriptDir\.."
$isElevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Display header
Write-Host "=== Query Tool Launcher ===" -ForegroundColor Cyan
Write-Host "Project Directory: $projectRoot" -ForegroundColor Cyan
Write-Host "Elevated: $isElevated" -ForegroundColor Cyan
Write-Host "`n"

# Check if running as Administrator, if not, relaunch with elevated rights
if (-not $isElevated) {
    Write-Host "Not running as Administrator. Relaunching with elevated rights..." -ForegroundColor Yellow
    Start-Process -FilePath PowerShell -Verb RunAs -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -Command `"Set-Location -Path '$projectRoot'; & '$scriptPath'`"" | Out-Null
    exit
}

# Change to the project root directory
Set-Location -Path $projectRoot

# Get the path to node
$nodePath = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $nodePath) {
    $nodePath = "$env:ProgramFiles\nodejs\node.exe"
    if (-not (Test-Path $nodePath)) {
        Write-Host "Could not find Node.js. Please make sure Node.js is installed." -ForegroundColor Red
        exit 1
    }
}

# Start the actual services
Write-Host "Starting application services..." -ForegroundColor Green

# Start Node Sync Service
Write-Host "`nStarting Node Sync Service..." -ForegroundColor Green
$global:syncProcess = Start-Process -PassThru -NoNewWindow -FilePath $nodePath -ArgumentList "services/node-sync/index.js" -WorkingDirectory $projectRoot

# Start UI Development Server
Write-Host "`nStarting UI Development Server..." -ForegroundColor Green
$global:uiProcess = Start-Process -PassThru -NoNewWindow -FilePath $nodePath -ArgumentList "node_modules/vite/bin/vite.js" -WorkingDirectory (Join-Path $projectRoot "services\ui")

# Open the application in default browser
$uiUrl = "http://localhost:5173"
Start-Process $uiUrl

# Keep the window open after completion
Write-Host "`nAll services have been started!" -ForegroundColor Green
Write-Host "UI is available at: $uiUrl" -ForegroundColor Cyan
Write-Host "`nPress any key to stop all services and close this window..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup processes
Write-Host "`nStopping all services..." -ForegroundColor Yellow
try {
    if ($global:syncProcess -and -not $global:syncProcess.HasExited) {
        Stop-Process -Id $global:syncProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    if ($global:uiProcess -and -not $global:uiProcess.HasExited) {
        Stop-Process -Id $global:uiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    Write-Host "All services have been stopped." -ForegroundColor Green
} catch {
    Write-Host "Error stopping services: $($_.Exception.Message)" -ForegroundColor Red
}
