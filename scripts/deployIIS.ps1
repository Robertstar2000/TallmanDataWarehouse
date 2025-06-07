# Elevate to Administrator if not already elevated
$scriptPath = $MyInvocation.MyCommand.Definition
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "Not running as Administrator. Relaunching with elevated rights..."
    $argStr = ($args | ForEach-Object { "`"$_`"" }) -join ' '
    Start-Process -FilePath PowerShell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $argStr"
    exit
}

# Default parameters
$UIPath=Join-Path -Path $PSScriptRoot -ChildPath '..\services\ui'
$SyncPath=Join-Path -Path $PSScriptRoot -ChildPath '..\services\node-sync'
$IISRoot='C:\inetpub\wwwroot\query-tool'
$SiteName='query-tool'
$HostName='query-tool.local'
$PhysicalPath='C:\inetpub\wwwroot\query-tool'

# ensure target dir exists
if (-not (Test-Path $IISRoot)) {
  New-Item -ItemType Directory -Path $IISRoot -Force
}
# Build the UI
npm --prefix $UIPath run build
# No build needed for node-sync service (using direct JS)
# npm --prefix $SyncPath run build

# Start or restart the Node sync backend using pm2
Write-Host "Starting Node sync backend with pm2..." -ForegroundColor Cyan
pm2 describe node-sync-service | Out-Null
if ($LASTEXITCODE -eq 0) {
    pm2 restart node-sync-service
} else {
    pm2 start "$SyncPath/index.js" --name node-sync-service
}

# Deploy to IIS directory
Copy-Item "$UIPath\dist\*" -Destination $IISRoot -Recurse -Force

# Deployment complete
Write-Host "UI deployed to $IISRoot" -ForegroundColor Green

Import-Module WebAdministration

# Create site if missing
if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
   New-Website -Name $SiteName `
      -PhysicalPath $PhysicalPath `
      -Port 80 `
      -HostHeader $HostName
}
else {
   # Remove any old host‐header on port 80
   Get-WebBinding -Name $SiteName -Protocol http -Port 80 | Where-Object BindingInformation -NotLike "*:$HostName" | Remove-WebBinding -Confirm:$false

   # Add (or re‐add) the desired host header
   New-WebBinding -Name $SiteName `
      -Protocol http `
      -Port 80 `
      -IPAddress "*" `
      -HostHeader $HostName
}

Restart-WebItem "IIS:\Sites\$SiteName"
Write-Host "Site bound to http://$HostName" -ForegroundColor Green