# chifu-wizard bootstrap (Windows PowerShell)
#
# Usage:
#   irm https://marshell.dev/install.ps1 | iex
#
# Installs Bun if it's missing, then runs the chifu setup wizard via bunx.
#
# To pass args to the wizard when using irm|iex, set $ChifuWizardArgs first:
#   $ChifuWizardArgs = '--yes'; irm https://marshell.dev/install.ps1 | iex

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "!  $msg" -ForegroundColor Yellow }

function Find-Bun {
  $cmd = Get-Command bun -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  if (Test-Path $fallback) { return $fallback }
  return $null
}

$bun = Find-Bun
if ($bun) {
  Write-Info "Found Bun at $bun"
} else {
  Write-Info 'Bun not found - installing it (https://bun.sh)...'
  try {
    # Official Bun installer for Windows PowerShell.
    Invoke-RestMethod -Uri 'https://bun.sh/install.ps1' | Invoke-Expression
  } catch {
    Write-Warn "Failed to install Bun automatically: $($_.Exception.Message)"
    Write-Warn 'Install Bun manually from https://bun.sh then re-run: bunx @mfinikov/chifu-wizard'
    exit 1
  }
  # Make the freshly-installed bun discoverable in this session.
  $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
  if (Test-Path $bunBin) { $env:PATH = "$bunBin;$env:PATH" }
  $bun = Find-Bun
  if (-not $bun) {
    Write-Warn 'Bun installed but could not be located. Open a new terminal and run: bunx @mfinikov/chifu-wizard'
    exit 1
  }
  Write-Info 'Bun installed.'
}

Write-Info 'Launching the chifu wizard...'
# Forward optional args set by the caller (irm|iex cannot pass positional args).
$wizardArgs = @()
if ($ChifuWizardArgs) { $wizardArgs = $ChifuWizardArgs -split '\s+' }
& $bun x @mfinikov/chifu-wizard @wizardArgs
exit $LASTEXITCODE
