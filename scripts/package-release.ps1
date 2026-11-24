<#
.SYNOPSIS
  Builds a release and leaves every file to publish in `release/`.

.DESCRIPTION
  Used by the GitHub workflow and for local tests. See docs/publicar-version.md.

  Output (fixed names, whatever the display name is):
    ClipboardSync.exe            portable
    ClipboardSync.custom         zip with ClipboardSync.exe, for networks that block .exe/.zip
    ClipboardSync-setup.exe      installer
    ClipboardSync-setup.custom   zip with ClipboardSync-setup.exe
    update.json                  read by v2+ to update themselves; carries the "## Novedades" items of .github/release-notes.md
    latest.yml                   read by the Electron versions (v1.x) to migrate to this one

  Signing needs the private key in TAURI_SIGNING_PRIVATE_KEY (its text) or
  TAURI_SIGNING_PRIVATE_KEY_PATH (its file), plus TAURI_SIGNING_PRIVATE_KEY_PASSWORD if it has one.

.EXAMPLE
  ./scripts/package-release.ps1 -Version 2.0.1
  ./scripts/package-release.ps1 -Version 2.0.1 -AppName "Otro nombre"
#>
param(
  [Parameter(Mandatory)] [string] $Version,
  # Name shown in the window, tray and installer. Empty keeps the one in tauri.conf.json.
  [string] $AppName = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root "release"
$utf8 = New-Object System.Text.UTF8Encoding($false)

# Runs an external program. Its stderr is printed, not treated as a failure (Windows PowerShell 5.1
# would stop on npm's notices); only the exit code decides.
function Invoke-Native([string] $What, [scriptblock] $Command) {
  $ErrorActionPreference = "Continue"
  & $Command 2>&1 | ForEach-Object { "$_" } | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE)" }
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3 (got '$Version')" }
# Same rule as `release_notes::parse` in Rust: the `- ` lines under "## Novedades", up to the next "## ".
$inSection = $false
$notes = @(foreach ($line in Get-Content (Join-Path $root ".github\release-notes.md") -Encoding UTF8) {
  if ($line.Trim() -eq "## Novedades") { $inSection = $true; continue }
  if ($line.StartsWith("## ")) { $inSection = $false }
  if ($inSection -and $line.Trim().StartsWith("- ")) { $item = $line.Trim().Substring(2).Trim(); if ($item) { $item } }
})
if ($notes.Count -eq 0) { throw "release-notes.md has no '- ' lines under '## Novedades': write what this version brings before publishing." }
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
  throw "Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH to sign the release."
}

# 1. Build. The version (and the name, if given) are passed as config overrides, so no file is edited.
$override = @{ version = $Version }
if ($AppName) { $override.productName = $AppName }
$overrideFile = Join-Path ([IO.Path]::GetTempPath()) "clipboard-sync-release.json"
[IO.File]::WriteAllText($overrideFile, ($override | ConvertTo-Json), $utf8)
# An installer left from a build with another name would be taken for this one.
$bundle = Join-Path $root "target\release\bundle\nsis"
if (Test-Path $bundle) { Remove-Item $bundle -Recurse -Force }
# npx must run from the project to find the Tauri CLI; the caller's folder is restored at the end.
Push-Location $root
trap { Pop-Location; break }
Invoke-Native "tauri build" { npx tauri build --config $overrideFile }

# 2. Copy the two executables with their fixed names.
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null
$target = Join-Path $root "target\release"
Copy-Item (Join-Path $target "ClipboardSync.exe") (Join-Path $out "ClipboardSync.exe")
$setup = Get-ChildItem $bundle -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $setup) { throw "Installer for $Version not found" }
Copy-Item $setup.FullName (Join-Path $out "ClipboardSync-setup.exe")

# 3. Sign them and wrap each one in its .custom zip.
function Publish-Package([string] $exeName, [string] $customName) {
  $exe = Join-Path $out $exeName
  Invoke-Native "Signing $exeName" { npx tauri signer sign --app-version $Version $exe }
  $signature = (Get-Content "$exe.sig" -Raw).Trim()
  Remove-Item "$exe.sig"

  $zip = Join-Path $out "$customName.zip"
  Compress-Archive -Path $exe -DestinationPath $zip
  Move-Item $zip (Join-Path $out $customName)
  return [ordered]@{ file = $exeName; custom = $customName; signature = $signature }
}
$portable = Publish-Package "ClipboardSync.exe" "ClipboardSync.custom"
$installer = Publish-Package "ClipboardSync-setup.exe" "ClipboardSync-setup.custom"

# 4. update.json, for v2 and later.
$manifest = [ordered]@{ version = $Version; notes = $notes; portable = $portable; installer = $installer }
[IO.File]::WriteAllText((Join-Path $out "update.json"), ($manifest | ConvertTo-Json), $utf8)

# 5. latest.yml, for the Electron versions: same format they already read, pointing to the portable .custom.
$custom = Join-Path $out "ClipboardSync.custom"
$sha512 = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes($custom)))
$size = (Get-Item $custom).Length
$date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$yaml = "version: $Version`nfiles:`n  - url: ClipboardSync.custom`n    sha512: $sha512`n    size: $size`npath: ClipboardSync.custom`nsha512: $sha512`nreleaseDate: '$date'`n"
[IO.File]::WriteAllText((Join-Path $out "latest.yml"), $yaml, $utf8)

Get-ChildItem $out | Format-Table Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 2) } } | Out-Host
Pop-Location
