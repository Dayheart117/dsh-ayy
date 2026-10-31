# 把 dsh-ayy-world 的源码同步到 dsh 真正加载的那份副本
# ⚠️ 只改源码是不会生效的 —— profile 里那份才是被 import 的
$ErrorActionPreference = 'Stop'

$src = 'E:\AI\dsh-ayy\packages\dsh-ayy-world'
$dst = 'C:\Users\dayheart\.dsh\profiles\desktop\node_modules\dsh-ayy-world'

if (-not (Test-Path $src)) { throw "源码目录不存在：$src" }
if (-not (Test-Path $dst)) { throw "profile 副本不存在：$dst" }

New-Item -ItemType Directory -Force -Path (Join-Path $dst 'tools') | Out-Null
Copy-Item (Join-Path $src 'index.js') (Join-Path $dst 'index.js') -Force
Copy-Item (Join-Path $src 'package.json') (Join-Path $dst 'package.json') -Force
Copy-Item (Join-Path $src 'cordis.patch.yml') (Join-Path $dst 'cordis.patch.yml') -Force
Copy-Item (Join-Path $src 'tools\recall.cjs') (Join-Path $dst 'tools\recall.cjs') -Force

Write-Host '已同步。重启 dsh 后生效。'
Get-ChildItem $dst -Recurse -File | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize
