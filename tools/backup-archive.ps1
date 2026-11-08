# Back up the conversation archive: raw sessions + archive.db.
#
# Why: we already moved data once without a backup and had to stop. Never again.
# Keeps the last 7 runs; each run is a dated folder.
#
# ASCII-only on purpose (PS 5.1 misreads BOM-less files as ANSI).
param(
  [string]$Dest = "E:\AI\backups",
  [int]$Keep = 7
)
$ErrorActionPreference = 'Continue'

$dsh = Join-Path $env:USERPROFILE '.dsh'
$sessions = Join-Path $dsh 'sessions'
$archive = Join-Path $dsh 'ayy-archive'

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $Dest ("archive-" + $stamp)
New-Item -ItemType Directory -Force -Path $out | Out-Null

$log = Join-Path $Dest 'archive-backup.log'

# 1) raw sessions (source of truth for every chunk)
if (Test-Path $sessions) {
  robocopy $sessions (Join-Path $out 'sessions') /E /NFL /NDL /NJH /NJS /NC /NS /R:1 /W:1 | Out-Null
  Write-Host "sessions copied"
}

# 2) archive database + config (with WAL checkpoint so the .db is self-contained)
$db = Join-Path $archive 'archive.db'
if (Test-Path $db) {
  $node = Get-ChildItem (Join-Path $dsh 'dsh-runtimes') -Recurse -Filter node.exe -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($node) {
    $js = @"
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync(process.argv[2]);
try{d.exec('PRAGMA wal_checkpoint(TRUNCATE)')}catch(e){}
d.close();
"@
    $tmp = Join-Path $env:TEMP 'ckpt.cjs'
    [System.IO.File]::WriteAllText($tmp, $js, (New-Object System.Text.UTF8Encoding($false)))
    & $node.FullName $tmp $db 2>$null
  }
  Copy-Item $db (Join-Path $out 'archive.db') -Force
  Copy-Item (Join-Path $archive 'config.json') $out -Force -ErrorAction SilentlyContinue
  Write-Host "archive.db copied"
}

# 3) rotate
$runs = Get-ChildItem $Dest -Directory -Filter 'archive-*' | Sort-Object Name -Descending
if ($runs.Count -gt $Keep) {
  $runs | Select-Object -Skip $Keep | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    Add-Content $log "$stamp  pruned $($_.Name)"
  }
}

$size = (Get-ChildItem $out -Recurse -File | Measure-Object -Sum Length).Sum
$mb = [math]::Round($size / 1MB, 1)
Add-Content $log "$stamp  ok  $out  $mb MB"
Write-Host "done: $out  ($mb MB)"
