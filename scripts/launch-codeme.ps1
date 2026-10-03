param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodeArgs
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Error "CodeMe: $Message"
  exit 1
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$CodeOss = Join-Path $Root "code-oss"
$UserData = Join-Path $Root ".tools\codeme-user-data"
$ExtensionsDir = Join-Path $Root ".tools\codeme-extensions"
$ExtensionDevPath = Join-Path $Root "extensions\codeme-shell"
$PinnedNode = Join-Path $Root ".tools\node-v24.18.0-win-x64\node.exe"
$EnvFile = Join-Path $Root ".env"
$EnvExample = Join-Path $Root ".env.example"

function Get-CodeMeNode {
  if (Test-Path $PinnedNode) {
    return $PinnedNode
  }

  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node) {
    Fail "Node 24.18.0 is required. Run scripts\setup-codeme-windows.ps1 after installing Node 24.18.0."
  }

  $version = (& $node.Source --version 2>$null).TrimStart("v")
  if ($version -ne "24.18.0") {
    Fail "Code - OSS is pinned to Node 24.18.0, but '$version' is active. Install Node 24.18.0 or place it at .tools\node-v24.18.0-win-x64\node.exe."
  }
  return $node.Source
}

function Find-CodeOssExecutable {
  $candidates = @(
    (Join-Path $CodeOss ".build\electron\Code - OSS.exe"),
    (Join-Path $CodeOss ".build\electron\Code - OSS\Code - OSS.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  $electronRoot = Join-Path $CodeOss ".build\electron"
  if (Test-Path $electronRoot) {
    $found = Get-ChildItem -Path $electronRoot -Filter "Code - OSS.exe" -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($found) {
      return $found.FullName
    }
  }

  Fail "Code - OSS is not built for Windows. Run scripts\setup-codeme-windows.ps1 first."
}

function Import-DotEnv([string]$Path) {
  if (-not (Test-Path $Path)) { return }

  foreach ($raw in Get-Content -Path $Path) {
    $line = $raw.Trim()
    if (-not $line -or $line.StartsWith("#")) { continue }
    if ($line.StartsWith("export ")) { $line = $line.Substring(7).Trim() }
    $match = [regex]::Match($line, '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
    if (-not $match.Success) { continue }

    $name = $match.Groups[1].Value
    $value = $match.Groups[2].Value.Trim()
    if ($value.Length -ge 2) {
      $first = $value.Substring(0, 1)
      $last = $value.Substring($value.Length - 1, 1)
      if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
        $value = $value.Substring(1, $value.Length - 2)
      } else {
        $value = [regex]::Replace($value, '\s+#.*$', '')
      }
    } else {
      $value = [regex]::Replace($value, '\s+#.*$', '')
    }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

$NodeExe = Get-CodeMeNode
$CodeExe = Find-CodeOssExecutable

if (-not (Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
  Copy-Item $EnvExample $EnvFile
  Write-Host "CodeMe: created .env from .env.example. Add private tokens to .env only."
}
Import-DotEnv $EnvFile

New-Item -ItemType Directory -Force -Path $UserData | Out-Null
New-Item -ItemType Directory -Force -Path $ExtensionsDir | Out-Null

$NodeDir = Split-Path -Parent $NodeExe
$env:PATH = "$NodeDir;$env:PATH"
$env:CODEME_ROOT = $Root
$env:NODE_ENV = "development"
$env:VSCODE_DEV = "1"
$env:VSCODE_CLI = "1"
$env:VSCODE_SKIP_PRELAUNCH = "1"

Write-Host "CodeMe Windows"
Write-Host "  Root: $Root"
Write-Host "  Node: $(& $NodeExe --version)"
Write-Host "  Code OSS: $CodeExe"
Write-Host "  Profile: $UserData"

$arguments = @(
  ".",
  "--extensionDevelopmentPath=$ExtensionDevPath",
  "--extensions-dir=$ExtensionsDir",
  "--disable-extension=vscode.vscode-api-tests",
  "--disable-workspace-trust",
  "--user-data-dir=$UserData"
)
if ($CodeArgs) { $arguments += $CodeArgs }

Push-Location $CodeOss
try {
  & $CodeExe @arguments
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
