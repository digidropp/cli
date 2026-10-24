# Installs the Digidropp CLI on Windows. In PowerShell:
#   irm https://digidropp.online/install.ps1 | iex
#
# Options (environment variables): DIGIDROPP_VERSION (default: latest), DIGIDROPP_INSTALL_DIR
$ErrorActionPreference = 'Stop'

$repo = 'digidropp/cli'
$version = if ($env:DIGIDROPP_VERSION) { $env:DIGIDROPP_VERSION } else { 'latest' }
$installDir = if ($env:DIGIDROPP_INSTALL_DIR) { $env:DIGIDROPP_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.digidropp\bin' }
$base = if ($version -eq 'latest') { "https://github.com/$repo/releases/latest/download" } else { "https://github.com/$repo/releases/download/v$($version.TrimStart('v'))" }
if ($env:DIGIDROPP_DOWNLOAD_BASE) { $base = $env:DIGIDROPP_DOWNLOAD_BASE }

if (-not [Environment]::Is64BitOperatingSystem) { throw 'Digidropp CLI needs 64-bit Windows.' }

$asset = 'digidropp-windows-x64.zip'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("digidropp-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  Write-Host 'Downloading Digidropp CLI (windows-x64)...'
  $ProgressPreference = 'SilentlyContinue' # makes Invoke-WebRequest much faster
  Invoke-WebRequest -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset) -UseBasicParsing
  Invoke-WebRequest -Uri "$base/checksums.txt" -OutFile (Join-Path $tmp 'checksums.txt') -UseBasicParsing

  # Check the download matches the published checksum before running anything.
  $line = Get-Content (Join-Path $tmp 'checksums.txt') | Where-Object { $_ -match " $([regex]::Escape($asset))$" }
  if (-not $line) { throw "No checksum published for $asset." }
  $expected = ($line -split '\s+')[0].ToLower()
  $actual = (Get-FileHash (Join-Path $tmp $asset) -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) { throw "Checksum mismatch for $asset; not installing." }

  Expand-Archive -Path (Join-Path $tmp $asset) -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Move-Item -Path (Join-Path $tmp 'digidropp-windows-x64.exe') -Destination (Join-Path $installDir 'digidropp.exe') -Force
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

$installed = & (Join-Path $installDir 'digidropp.exe') --version
Write-Host "Installed digidropp $installed to $installDir\digidropp.exe" -ForegroundColor Green

# Add the install folder to the user's PATH for future terminals.
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $installDir)) {
  $newPath = (@($userPath, $installDir) | Where-Object { $_ }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Host "  Added $installDir to your PATH. Open a new terminal to use it."
}

Write-Host ''
Write-Host 'Next:'
Write-Host '  digidropp login     # once, with a token from Digidropp -> CI & tokens'
Write-Host '  digidropp           # in your app''s folder: build, upload, get a link + QR code'
