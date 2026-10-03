param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Error "CodeMe Windows setup: $Message"
  exit 1
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CodeOss = Join-Path $Root "code-oss"

if ($env:OS -ne "Windows_NT") {
  Fail "This setup script must be run on Windows."
}

foreach ($tool in @("git.exe", "node.exe", "npm.cmd", "python.exe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Fail "$tool is required and was not found in PATH."
  }
}

$nodeVersion = (& node.exe --version).TrimStart("v")
if ($nodeVersion -ne "24.18.0") {
  Fail "Node 24.18.0 is required by the pinned Code - OSS source. Active version: $nodeVersion"
}

Write-Host "CodeMe Windows prerequisites"
Write-Host "  Git:    $(& git.exe --version)"
Write-Host "  Node:   $(& node.exe --version)"
Write-Host "  npm:    $(& npm.cmd --version)"
Write-Host "  Python: $(& python.exe --version)"

$gitmodules = Join-Path $Root ".gitmodules"
if (-not (Test-Path $gitmodules)) {
  Fail ".gitmodules is missing."
}

Push-Location $Root
try {
  Write-Host ""
  Write-Host "Initializing pinned Code - OSS submodule..."
  & git.exe submodule update --init --depth 1 code-oss
  if ($LASTEXITCODE -ne 0) { Fail "git submodule update failed." }
} finally {
  Pop-Location
}

if ($SkipBuild) {
  Write-Host "Skipping Code - OSS build because -SkipBuild was supplied."
  exit 0
}

Push-Location $CodeOss
try {
  Write-Host ""
  Write-Host "Installing Code - OSS dependencies. This is the slow step on a fresh PC..."
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed inside code-oss." }

  Write-Host ""
  Write-Host "Preparing the pinned Electron build..."
  & node.exe build\lib\preLaunch.ts
  if ($LASTEXITCODE -ne 0) { Fail "Code - OSS preLaunch failed." }
} finally {
  Pop-Location
}

$exeCandidates = @(
  (Join-Path $CodeOss ".build\electron\Code - OSS.exe"),
  (Join-Path $CodeOss ".build\electron\Code - OSS\Code - OSS.exe")
)
$built = $false
foreach ($candidate in $exeCandidates) {
  if (Test-Path $candidate) { $built = $true; break }
}
if (-not $built -and (Test-Path (Join-Path $CodeOss ".build\electron"))) {
  $built = [bool](Get-ChildItem -Path (Join-Path $CodeOss ".build\electron") -Filter "Code - OSS.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)
}
if (-not $built) {
  Fail "The Code - OSS Windows executable was not found after preLaunch."
}

Write-Host ""
Write-Host "CodeMe Windows setup is ready."
Write-Host "Launch with:"
Write-Host "  .\scripts\launch-codeme.ps1"
Write-Host "or double-click/run:"
Write-Host "  scripts\launch-codeme.cmd"
