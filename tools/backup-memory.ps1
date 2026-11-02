# Backup her memory into a local git repo.
#
# Source of truth:  ~/.dsh/personas  (diary, self-description, wish list)
#                   ~/.dsh/memory    (MEMORY.md + archived notes)
# Destination:      E:\AI\her-memory  (git repo; every run makes one commit)
#
# ASCII-only on purpose: Windows PowerShell reads BOM-less files as ANSI and
# breaks on Chinese punctuation. Do not put Chinese comments in this file.
#
# ErrorActionPreference stays 'Continue': git writes progress to stderr, and
# with 'Stop' PowerShell turns those warnings into terminating errors.
$ErrorActionPreference = 'Continue'

$personas = Join-Path $env:USERPROFILE '.dsh\personas'
$memory   = Join-Path $env:USERPROFILE '.dsh\memory'
$dest     = 'E:\AI\her-memory'
$log      = Join-Path $dest 'backup.log'

if (-not (Test-Path $personas)) { throw "personas dir missing: $personas" }
if (-not (Test-Path $memory))   { throw "memory dir missing: $memory" }
if (-not (Test-Path (Join-Path $dest '.git'))) { throw "not a git repo: $dest" }

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'

# 1) personas: copy everything except the regenerable caches
$pDest = Join-Path $dest 'personas'
New-Item -ItemType Directory -Force -Path $pDest | Out-Null
Copy-Item (Join-Path $personas '*.md') $pDest -Force -ErrorAction SilentlyContinue
# notes      = her own notebooks (topics: exam errors, interview cards, backstory...)
# notes-history / who-i-am-history / diary-history = old versions of the above
# memory-history = pre-write copies made by ayy_memory (kept out of git on purpose:
#                  it IS the rollback mechanism, and git already versions her-memory.md)
foreach ($sub in @('diary', 'diary-history', 'who-i-am-history', 'notes', 'notes-history', 'ledger')) {
  $from = Join-Path $personas $sub
  $to = Join-Path $pDest $sub
  if (Test-Path $from) {
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    Copy-Item (Join-Path $from '*') $to -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 2) memory: MEMORY.md + archived notes + their pre-write history
$mDest = Join-Path $dest 'memory'
New-Item -ItemType Directory -Force -Path $mDest | Out-Null
Copy-Item (Join-Path $memory '*.md') $mDest -Force -ErrorAction SilentlyContinue
$memHist = Join-Path $memory '.history'
if (Test-Path $memHist) {
  $to = Join-Path $mDest '.history'
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item (Join-Path $memHist '*') $to -Recurse -Force -ErrorAction SilentlyContinue
}

# 3) commit
Push-Location $dest
git add -A 2>&1 | Out-Null
$pending = git status --porcelain 2>&1
if ([string]::IsNullOrWhiteSpace(($pending -join ''))) {
  Add-Content -Path $log -Value "$stamp  no changes"
  Write-Host 'no changes'
} else {
  $count = @($pending | Where-Object { $_.Trim() }).Count
  git -c core.autocrlf=false commit -q -m "backup: $stamp ($count files changed)" 2>&1 | Out-Null
  Add-Content -Path $log -Value "$stamp  committed ($count files changed)"
  Write-Host "committed ($count files changed)"
}
Pop-Location
