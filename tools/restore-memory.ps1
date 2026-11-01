# Restore her memory from the snapshot repo.
#
# Usage:
#   restore-memory.ps1                 -> roll back to the previous commit (HEAD~1)
#   restore-memory.ps1 -Commit <hash>  -> roll back to that snapshot
#   restore-memory.ps1 -List           -> show recent snapshots
#
# It backs up the CURRENT live state first (into .dsh\restore-safety\), so a
# wrong rollback can itself be undone by copying that folder back.
#
# ASCII-only on purpose: Windows PowerShell reads BOM-less files as ANSI and
# breaks on Chinese punctuation.
param(
  [string]$Commit = 'HEAD~1',
  [switch]$List
)

$ErrorActionPreference = 'Continue'

$repo    = 'E:\AI\her-memory'
$personas = Join-Path $env:USERPROFILE '.dsh\personas'
$memory   = Join-Path $env:USERPROFILE '.dsh\memory'
$safety   = Join-Path $env:USERPROFILE ('.dsh\restore-safety\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

if (-not (Test-Path (Join-Path $repo '.git'))) { throw "not a git repo: $repo" }

if ($List) {
  git -C $repo log --oneline -20
  exit 0
}

# resolve the target commit properly
$hash = (git -C $repo rev-parse --verify "$Commit^{commit}" 2>$null)
if (-not $hash) { throw "cannot resolve commit: $Commit" }
$short = $hash.Substring(0, 7)

Write-Host "Restoring snapshot $short ($Commit)"

# 1) keep the live state first
New-Item -ItemType Directory -Force -Path $safety | Out-Null
if (Test-Path $personas) { Copy-Item $personas (Join-Path $safety 'personas') -Recurse -Force }
if (Test-Path $memory)   { Copy-Item $memory   (Join-Path $safety 'memory')   -Recurse -Force }
Write-Host "Current state saved to: $safety"

# 2) export the snapshot into a temp dir, then copy back
$tmp = Join-Path $env:TEMP ('her-memory-restore-' + $short)
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
git -C $repo archive $hash | tar -x -C $tmp
if ($LASTEXITCODE -ne 0) { throw "git archive failed" }

if (Test-Path (Join-Path $tmp 'personas')) { Copy-Item (Join-Path $tmp 'personas\*') $personas -Recurse -Force }
if (Test-Path (Join-Path $tmp 'memory'))   { Copy-Item (Join-Path $tmp 'memory\*')   $memory   -Recurse -Force }
Write-Host "Restored."
Write-Host "If this was a mistake, copy back from: $safety"
