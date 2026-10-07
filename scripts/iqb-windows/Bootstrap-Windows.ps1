param(
    [string]$Bundle = (Join-Path $PSScriptRoot "bundle"),
    [ValidateSet("IQB-Kodieren", "itc-ToolBox")]
    [string]$App = "IQB-Kodieren",
    [switch]$Install,
    [switch]$Inspect,
    [ValidateSet("installed", "bundle")]
    [string]$Launch = "installed"
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") {
    throw "Run this script inside Windows 11, in a logged-in desktop session."
}
$Bundle = (Resolve-Path -LiteralPath $Bundle).Path
$Python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe"
if (-not (Test-Path -LiteralPath $Python)) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "Python 3.11 and winget are missing. Install Python 3.11 x64 from python.org first."
    }
    & winget.exe install --id Python.Python.3.11 --exact --source winget --architecture x64 --scope user --disable-interactivity
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Python)) {
        throw "Python installation did not complete. Check the installer and retry."
    }
}
$Venv = Join-Path $PSScriptRoot ".venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
    & $Python -m venv $Venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create the Python environment." }
}
$Probe = Join-Path $PSScriptRoot "windows_probe.py"
$Artifacts = Join-Path $PSScriptRoot "artifacts\$App"
& $VenvPython $Probe --bundle $Bundle --app $App --verify-only --output $Artifacts
if ($LASTEXITCODE -ne 0) { throw "The IQB bundle failed its integrity check." }

if ($Install) {
    $Catalogue = Get-Content -LiteralPath (Join-Path $Bundle "bundle.json") -Raw | ConvertFrom-Json
    $Application = @($Catalogue.applications | Where-Object { $_.id -eq $App })
    if ($Application.Count -ne 1) { throw "Application is missing from the verified bundle." }
    $Setup = Join-Path $Bundle $Application[0].setup
    Start-Process -FilePath $Setup -WorkingDirectory (Split-Path -Parent $Setup) -Wait
    Write-Host "Complete all ClickOnce dialogs, then close the application before inspecting it."
}
if ($Inspect) {
    & $VenvPython -m pip install -r (Join-Path $PSScriptRoot "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "Could not install the GUI automation dependencies." }
    & $VenvPython -m pip freeze | Set-Content -LiteralPath (Join-Path $Artifacts "python-packages.txt")
    & $VenvPython $Probe --bundle $Bundle --app $App --launch $Launch --output $Artifacts
    if ($LASTEXITCODE -ne 0) { throw "The Windows startup/GUI probe did not pass." }
}
