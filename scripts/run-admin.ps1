# run-admin.ps1
# Launcher to ensure start-app.ps1 runs in an elevated (Administrator) PowerShell

$script = Join-Path $PSScriptRoot "start-app.ps1"

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Not running as administrator. Relaunching as admin..."
    Start-Process powershell -Verb runAs -ArgumentList "-NoExit", "-ExecutionPolicy Bypass", "-File `"$script`""
    exit
} else {
    & $script
}
