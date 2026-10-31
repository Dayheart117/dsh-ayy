# Sync dsh-ayy-world sources into the copy dsh actually imports.
# NOTE: editing the repo alone does NOT take effect; the profile copy is what gets imported.
# ASCII-only on purpose: Windows PowerShell reads BOM-less files as ANSI and chokes on
# Chinese punctuation, which is exactly how this script broke once.
$ErrorActionPreference = 'Stop'

$src = 'E:\AI\dsh-ayy\packages\dsh-ayy-world'
$dst = 'C:\Users\dayheart\.dsh\profiles\desktop\node_modules\dsh-ayy-world'

if (-not (Test-Path $src)) { throw "source dir missing: $src" }
if (-not (Test-Path $dst)) { throw "profile copy missing: $dst" }

New-Item -ItemType Directory -Force -Path (Join-Path $dst 'tools') | Out-Null
Copy-Item (Join-Path $src 'index.js') (Join-Path $dst 'index.js') -Force
Copy-Item (Join-Path $src 'package.json') (Join-Path $dst 'package.json') -Force
Copy-Item (Join-Path $src 'cordis.patch.yml') (Join-Path $dst 'cordis.patch.yml') -Force
Copy-Item (Join-Path $src 'tools\recall.cjs') (Join-Path $dst 'tools\recall.cjs') -Force

Write-Host 'synced. restart dsh to apply.'
Get-ChildItem $dst -Recurse -File | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
