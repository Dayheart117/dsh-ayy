# Install the dsh-ayy plugin set into a DSH profile.
#
# What it does, per package in this repo:
#   1. creates a junction at <profile>\node_modules\<name>  ->  <repo>\packages\<name>
#      (junction, not copy: editing the repo changes the install, no re-sync)
#   2. adds "<name>": "file:<repo>/packages/<name>" to the profile package.json dependencies
#   3. adds "<name>" to dsh.profile.bundles
#
# After that the profile loads every plugin from the repo directly.
# Restart DSH once at the end.
#
# ASCII-only on purpose: Windows PowerShell reads BOM-less files as ANSI and
# breaks on Chinese punctuation.
param(
  [string]$Profile = "$env:USERPROFILE\.dsh\profiles\desktop",
  [string]$Repo = "E:\AI\dsh-ayy",
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

if (-not (Test-Path $Profile)) { throw "profile not found: $Profile" }
if (-not (Test-Path $Repo)) { throw "repo not found: $Repo" }

$pkgFile = Join-Path $Profile 'package.json'
if (-not (Test-Path $pkgFile)) { throw "no package.json in profile: $Profile" }

$modDir = Join-Path $Profile 'node_modules'
New-Item -ItemType Directory -Force -Path $modDir | Out-Null

# read package.json as text first (keep a backup before any change)
Copy-Item $pkgFile "$pkgFile.bak-installayy" -Force
$pkg = Get-Content $pkgFile -Encoding UTF8 -Raw | ConvertFrom-Json

# make sure the two containers exist
if (-not $pkg.dsh) { $pkg | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{}) -Force }
if (-not $pkg.dsh.profile) { $pkg.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{}) -Force }
if (-not $pkg.dsh.profile.bundles) {
  $pkg.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @() -Force
}
$bundles = @($pkg.dsh.profile.bundles)
$deps = $pkg.dependencies
if (-not $deps) { $deps = [pscustomobject]@{} ; $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue $deps -Force }

$pkgs = Get-ChildItem (Join-Path $Repo 'packages') -Directory | Where-Object {
  Test-Path (Join-Path $_.FullName 'package.json')
}

$addedLink = 0
$addedDep = 0
foreach ($p in $pkgs) {
  $name = $p.Name
  $src = $p.FullName
  $dst = Join-Path $modDir $name

  # 1) junction
  $existing = Get-Item $dst -ErrorAction SilentlyContinue
  if (-not $existing) {
    if ($DryRun) { Write-Host "[dry] junction $name -> $src" }
    else {
      New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
      $addedLink++
    }
  } elseif (-not $existing.LinkType) {
    Write-Host "[warn] $name exists as a real folder (not a junction); leaving it alone"
  }

  # 2) dependency
  if (-not ($deps.PSObject.Properties.Name -contains $name)) {
    if ($DryRun) { Write-Host "[dry] dep $name" }
    else {
      $deps | Add-Member -NotePropertyName $name -NotePropertyValue ("file:" + $src.Replace('\', '/')) -Force
      $addedDep++
    }
  }

  # 3) bundle
  if ($bundles -notcontains $name) { $bundles += $name }
}

if ($DryRun) { Write-Host "[dry] done, nothing written"; exit 0 }

$pkg.dsh.profile.bundles = $bundles
$json = $pkg | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($pkgFile, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Done."
Write-Host "  new junctions : $addedLink"
Write-Host "  new deps      : $addedDep"
Write-Host "  bundles total : $($bundles.Count)"
Write-Host ""
Write-Host "Restart DSH once, then the plugins load from the repo."
Write-Host "Backup of the old package.json: $pkgFile.bak-installayy"
