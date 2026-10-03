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
$Tools = Join-Path $Root ".tools"
$NodeDir = Join-Path $Tools "node-v24.18.0-win-x64"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"

if ($env:OS -ne "Windows_NT") {
  Fail "This setup script must be run on Windows."
}

if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
  Fail "Git for Windows is required and was not found in PATH."
}

function Resolve-Python {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($python) { return $python.Source }

  $python3 = Get-Command python3.exe -ErrorAction SilentlyContinue
  if ($python3) { return $python3.Source }

  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    $resolved = (& $py.Source -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
    if ($resolved -and (Test-Path $resolved.Trim())) { return $resolved.Trim() }
  }

  return ""
}

function Ensure-PinnedNode {
  if ((Test-Path $NodeExe) -and (Test-Path $NpmCmd)) {
    $version = (& $NodeExe --version).TrimStart("v")
    if ($version -eq "24.18.0") { return }
  }

  New-Item -ItemType Directory -Force -Path $Tools | Out-Null
  $archive = Join-Path $Tools "node-v24.18.0-win-x64.zip"
  $download = "https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip"

  Write-Host "Downloading the pinned portable Node 24.18.0 runtime..."
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $archive
    if (Test-Path $NodeDir) { Remove-Item $NodeDir -Recurse -Force }
    Expand-Archive -Path $archive -DestinationPath $Tools -Force
  } catch {
    Fail "Could not install portable Node 24.18.0: $($_.Exception.Message)"
  } finally {
    Remove-Item $archive -Force -ErrorAction SilentlyContinue
  }

  if (-not (Test-Path $NodeExe) -or -not (Test-Path $NpmCmd)) {
    Fail "Portable Node 24.18.0 was downloaded but node.exe/npm.cmd were not found."
  }
}

function Assert-WindowsBuildTools {
  $vswhere = Join-Path $env:ProgramFiles "Microsoft Visual Studio\Installer\vswhere.exe"
  $vswhereX86 = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere) -and (Test-Path $vswhereX86)) { $vswhere = $vswhereX86 }
  if (-not (Test-Path $vswhere)) {
    Fail "Visual Studio Build Tools were not found. Install Visual Studio 2022 Build Tools with 'Desktop development with C++' and a Windows 10/11 SDK."
  }

  $install = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null | Select-Object -First 1)
  if (-not $install) {
    Fail "The Visual C++ build tools are missing. Modify Visual Studio Build Tools and enable 'Desktop development with C++'."
  }
  return $install
}

Ensure-PinnedNode
$PythonExe = Resolve-Python
if (-not $PythonExe) {
  Fail "Python 3 is required. Install Python 3 and enable 'Add python.exe to PATH'."
}
$VsInstall = Assert-WindowsBuildTools

$env:PATH = "$NodeDir;$env:PATH"
$env:PYTHON = $PythonExe
$env:npm_config_python = $PythonExe

Write-Host "CodeMe Windows prerequisites"
Write-Host "  Git:          $(& git.exe --version)"
Write-Host "  Node:         $(& $NodeExe --version) (portable CodeMe pin)"
Write-Host "  npm:          $(& $NpmCmd --version)"
Write-Host "  Python:       $(& $PythonExe --version)"
Write-Host "  Build Tools:  $VsInstall"

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
  & $NpmCmd install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed inside code-oss." }

  Write-Host ""
  Write-Host "Preparing the pinned Electron build..."
  & $NodeExe build\lib\preLaunch.ts
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
