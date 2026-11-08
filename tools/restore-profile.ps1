# Restore the profile after DSH's "Disable third-party plugins" button was used.
#
# What that button does: rewrites profiles/desktop/package.json down to the two
# base bundles, and shrinks cordis.patch.yml. Your ayy-* plugins are NOT deleted
# (junctions in node_modules stay), only unregistered.
#
# This script picks the NEWEST backup of each file and restores it, keeping the
# broken state next to it with a .disabled-<stamp> suffix.
#
# ASCII-only on purpose (PS 5.1 misreads BOM-less files as ANSI).

param(
  [string]$Profile = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
  [switch]$DryRun
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
function Restore-One($name, $pattern) {
  $cur = Join-Path $Profile $name
  $cands = Get-ChildItem $Profile -Filter $pattern |
    Where-Object { $_.Name -ne $name -and -not $_.Name.Contains('disabled') } |
    Sort-Object Length -Descending
  if (-not $cands) {
    Write-Host "no backup for $name"
    return
  }
  $best = $cands[0]
  $curSize = if (Test-Path $cur) { (Get-Item $cur).Length } else { 0 }
  Write-Host ("{0}: current {1} B -> {2} ({3} B)" -f $name, $curSize, $best.Name, $best.Length)
  if ($DryRun) { return }
  if (Test-Path $cur) { Copy-Item $cur "$cur.disabled-$stamp" -Force }
  Copy-Item $best.FullName $cur -Force
}

Restore-One 'package.json' 'package.json.bak-*'
Restore-One 'cordis.patch.yml' 'cordis.patch.yml.bak-*'

# Re-register every junction present in node_modules but missing from bundles
$pkgPath = Join-Path $Profile 'package.json'
if (-not $DryRun -and (Test-Path $pkgPath)) {
  $node = Get-ChildItem (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes') -Recurse -Filter node.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($node) {
    $js = @'
const fs = require('node:fs');
const path = require('node:path');
const prof = process.argv[2];
const pkgPath = path.join(prof, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const nm = path.join(prof, 'node_modules');
const have = new Set(pkg.dsh.profile.bundles || []);
const add = [];
for (const n of fs.readdirSync(nm)) {
  if (!n.startsWith('dsh-ayy') && !n.startsWith('dsh-') && !n.startsWith('@')) continue;
  const isDir = fs.statSync(path.join(nm, n)).isDirectory();
  if (!isDir) continue;
  let name = null;
  try {
    const p = JSON.parse(fs.readFileSync(path.join(nm, n, 'package.json'), 'utf8'));
    if (!p.dsh || !p.dsh.bundle) continue;
    name = p.name;
  } catch { continue; }
  if (name && !have.has(name)) add.push(name);
}
if (add.length) {
  pkg.dsh.profile.bundles = [...(pkg.dsh.profile.bundles || []), ...add];
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
}
console.log('re-added bundles:', add.join(', ') || '(none)');
console.log('total bundles:', (pkg.dsh.profile.bundles || []).length);
'@
    $tmp = Join-Path $env:TEMP 'restore-bundles.cjs'
    [System.IO.File]::WriteAllText($tmp, $js, (New-Object System.Text.UTF8Encoding($false)))
    & $node.FullName $tmp $Profile
  }
}

Write-Host ''
Write-Host 'Now fully quit DSH and start it again.'
