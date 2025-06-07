# Start-App.ps1 - Script to start all required services for the application

# Set execution policy for this session if needed
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force

# Get the project root directory
$projectRoot = Split-Path -Parent $PSScriptRoot

# Define ports used by the application
$ports = @(
    @{ Name = "Node Sync"; Port = 3000 },
    @{ Name = "Laravel API"; Port = 4100 },
    @{ Name = "UI Dev Server"; Port = 5173 }
)

# Function to kill processes on a specific port
function Stop-PortProcess {
    param (
        [int]$Port
    )
    
    $process = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | 
               Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
    
    if ($process) {
        Write-Host "Stopping process on port $Port (PID: $process)" -ForegroundColor Yellow
        Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    }
}

# Kill processes on all defined ports
Write-Host "Checking and stopping processes on required ports..." -ForegroundColor Cyan
foreach ($item in $ports) {
    Stop-PortProcess -Port $item.Port
}

# Get the path to node
$nodePath = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if (-not $nodePath) {
    $nodePath = "$env:ProgramFiles\nodejs\node.exe"
    if (-not (Test-Path $nodePath)) {
        Write-Host "Could not find Node.js. Please make sure Node.js is installed." -ForegroundColor Red
        exit 1
    }
}

# Start Node Sync Service
Write-Host "`nStarting Node Sync Service..." -ForegroundColor Green
$global:syncProcess = Start-Process -PassThru -NoNewWindow -FilePath $nodePath -ArgumentList "services/node-sync/index.js" -WorkingDirectory $projectRoot

# Start Laravel API (via IIS)
Write-Host "`nStarting Laravel API (IIS)..." -ForegroundColor Green
try {
    # Try to start IIS if it's not running
    $iisStatus = Get-Service -Name W3SVC -ErrorAction SilentlyContinue
    if ($iisStatus.Status -ne 'Running') {
        Start-Service W3SVC -ErrorAction Stop
    }
    
    # Verify database connection settings in the Laravel environment
    $envFile = Join-Path $projectRoot "services\laravel-api\.env"
    $dbConfigFile = Join-Path $projectRoot "services\laravel-api\config\database_connections.php"
    
    # Ensure database settings are correct
    $envContent = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
    if (-not ($envContent -match "EPICOR_DSN=p21 play")) {
        Write-Host "Updating P21 database connection settings..." -ForegroundColor Yellow
        $envContent = $envContent -replace "(EPICOR_DSN=)(.*?)$", "EPICOR_DSN=p21 play" -replace "(?ms)AWS_USE_PATH_STYLE_ENDPOINT=false\s+PUSHER_APP_ID=", "AWS_USE_PATH_STYLE_ENDPOINT=false`n`n# Database connection settings`nEPICOR_DSN=p21 play`nEPICOR_USERNAME=`nEPICOR_PASSWORD=`n`n# Point of Rental SQL connection`nPOR_HOST=localhost`nPOR_PORT=1433`nPOR_DATABASE=PointOfRental`nPOR_USERNAME=`nPOR_PASSWORD=`n`n# Other connections`nJOBSCOPE_DSN=JobScope`nJOBSCOPE_USERNAME=`nJOBSCOPE_PASSWORD=`n`nPUSHER_APP_ID="
        Set-Content -Path $envFile -Value $envContent
    }
    
    # Ensure correct database connection configuration
    $dbConfigContent = Get-Content $dbConfigFile -Raw -ErrorAction SilentlyContinue
    if (-not ($dbConfigContent -match "'dsn' => env\('EPICOR_DSN', 'p21 play'\)")) {
        Write-Host "Updating database connection configurations..." -ForegroundColor Yellow
        $dbConfigContent = $dbConfigContent -replace "'dsn' => env\('EPICOR_DSN', 'Epicor'\)", "'dsn' => env('EPICOR_DSN', 'p21 play')"
        $dbConfigContent = $dbConfigContent -replace "'point_of_rental' => \[\s+'driver' => 'odbc',\s+'dsn' => env\('POR_DSN', 'PointOfRental'\),\s+'username' => env\('POR_USERNAME', ''\),\s+'password' => env\('POR_PASSWORD', ''\),\s+\],", "'point_of_rental' => [`n            'driver' => 'sqlsrv',`n            'host' => env('POR_HOST', 'localhost'),`n            'port' => env('POR_PORT', '1433'),`n            'database' => env('POR_DATABASE', 'PointOfRental'),`n            'username' => env('POR_USERNAME', ''),`n            'password' => env('POR_PASSWORD', ''),`n            'charset' => 'utf8',`n            'prefix' => '',`n            'prefix_indexes' => true,`n        ],"
        Set-Content -Path $dbConfigFile -Value $dbConfigContent
    }
    
    # Restart the application pool to apply changes
    try {
        Write-Host "Recycling IIS application pool to apply changes..." -ForegroundColor Yellow
        $appPool = "DefaultAppPool"
        Import-Module WebAdministration -ErrorAction SilentlyContinue
        if (Get-Module WebAdministration) {
            if (Test-Path "IIS:\AppPools\$appPool") {
                Restart-WebAppPool -Name $appPool -ErrorAction SilentlyContinue
                Write-Host "Application pool recycled successfully" -ForegroundColor Green
            }
        } else {
            # Fallback if WebAdministration module isn't available
            $iisResetResult = Start-Process "iisreset" -ArgumentList "/restart" -Wait -NoNewWindow -PassThru
            if ($iisResetResult.ExitCode -eq 0) {
                Write-Host "IIS restarted successfully" -ForegroundColor Green
            } else {
                Write-Host "Warning: Could not restart IIS automatically. May need manual restart." -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host "Warning: Could not recycle application pool. Changes may not be applied immediately." -ForegroundColor Yellow
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
    
    Write-Host "IIS is running" -ForegroundColor Green
} catch {
    Write-Host "Failed to start IIS. Make sure IIS is installed and you have sufficient permissions." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

# Start UI Development Server
Write-Host "`nStarting UI Development Server..." -ForegroundColor Green

# Ensure the UI is configured to connect to the correct backend port
$viteConfigFile = Join-Path $projectRoot "services\ui\vite.config.js"
$viteConfig = Get-Content $viteConfigFile -Raw -ErrorAction SilentlyContinue
if (-not ($viteConfig -match "target: 'http://localhost:4100'")) {
    Write-Host "Updating UI proxy configuration to use port 4100..." -ForegroundColor Yellow
    $viteConfig = $viteConfig -replace "target: 'http://localhost:\d+'", "target: 'http://localhost:4100'"
    Set-Content -Path $viteConfigFile -Value $viteConfig
}

$global:uiProcess = Start-Process -PassThru -NoNewWindow -FilePath $nodePath -ArgumentList "node_modules/vite/bin/vite.js" -WorkingDirectory (Join-Path $projectRoot "services\ui")

# Open the application in default browser
$uiUrl = "http://localhost:5173"
Write-Host "`nApplication is starting..." -ForegroundColor Cyan
Write-Host "UI will be available at: $uiUrl" -ForegroundColor Cyan
Start-Process $uiUrl

Write-Host "`nAll services have been started!" -ForegroundColor Green
Write-Host "Press any key to stop all services..." -ForegroundColor Yellow

# Wait for key press
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Cleanup on exit
Write-Host "`nStopping all services..." -ForegroundColor Yellow

try {
    if ($global:syncProcess -and -not $global:syncProcess.HasExited) {
        Stop-Process -Id $global:syncProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    if ($global:uiProcess -and -not $global:uiProcess.HasExited) {
        Stop-Process -Id $global:uiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    # Don't stop IIS as it might affect other sites
    # iisreset /stop
    
    Write-Host "All services have been stopped." -ForegroundColor Green
} catch {
    Write-Host "Error stopping services: $($_.Exception.Message)" -ForegroundColor Red
}
