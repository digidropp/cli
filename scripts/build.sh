#!/bin/sh
# Compiles the CLI into standalone executables (no Node needed) for every platform, then packs them for GitHub
# Releases: .gz for macOS/Linux (install.sh), .zip for Windows (install.ps1), plus checksums.txt.
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist

for target in darwin-arm64 darwin-x64 linux-x64 linux-arm64 windows-x64; do
  out="dist/digidropp-$target"
  [ "$target" = "windows-x64" ] && out="$out.exe"
  bun build src/index.js --compile --minify --target="bun-$target" --outfile "$out"
done

cd dist
for f in digidropp-darwin-* digidropp-linux-*; do gzip -9 -f "$f"; done
zip -q -j digidropp-windows-x64.zip digidropp-windows-x64.exe && rm digidropp-windows-x64.exe
shasum -a 256 digidropp-* > checksums.txt
ls -lh
