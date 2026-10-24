#!/bin/sh
# Installs the Digidropp CLI on macOS and Linux:
#   curl -fsSL https://digidropp.online/install.sh | sh
#
# Options (environment variables):
#   DIGIDROPP_VERSION      a version like 0.1.0 (default: latest)
#   DIGIDROPP_INSTALL_DIR  where to put the binary (default: ~/.digidropp/bin)
set -eu

REPO="digidropp/cli"
VERSION="${DIGIDROPP_VERSION:-latest}"
INSTALL_DIR="${DIGIDROPP_INSTALL_DIR:-$HOME/.digidropp/bin}"

if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/v${VERSION#v}"
fi
# Lets a mirror or a local test server stand in for GitHub Releases.
BASE="${DIGIDROPP_DOWNLOAD_BASE:-$BASE}"

say() { printf '%s\n' "$*"; }
fail() { printf 'digidropp install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported system $(uname -s). On Windows, run in PowerShell: irm https://digidropp.online/install.ps1 | iex" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported processor $(uname -m)." ;;
esac
# A terminal running under Rosetta reports x86_64 on Apple Silicon; install the native build instead.
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi

asset="digidropp-$os-$arch.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

download() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else fail "curl or wget is required."; fi
}

say "Downloading Digidropp CLI ($os-$arch)…"
download "$BASE/$asset" "$tmp/$asset" || fail "download failed: $BASE/$asset"
download "$BASE/checksums.txt" "$tmp/checksums.txt" || fail "couldn't download checksums.txt"

# Check the download matches the published checksum before running anything.
expected="$(grep " $asset\$" "$tmp/checksums.txt" | cut -d ' ' -f 1)"
[ -n "$expected" ] || fail "no checksum published for $asset."
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp/$asset" | cut -d ' ' -f 1)"
else actual="$(shasum -a 256 "$tmp/$asset" | cut -d ' ' -f 1)"; fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset; not installing."

gunzip "$tmp/$asset"
mkdir -p "$INSTALL_DIR"
mv "$tmp/digidropp-$os-$arch" "$INSTALL_DIR/digidropp"
chmod +x "$INSTALL_DIR/digidropp"

say "✓ Installed digidropp $("$INSTALL_DIR/digidropp" --version) to $INSTALL_DIR/digidropp"

# Put the install folder on PATH for future terminals, if it isn't already.
case ":$PATH:" in
  *":$INSTALL_DIR:"*) on_path=1 ;;
  *) on_path=0 ;;
esac
if [ "$on_path" = 0 ]; then
  line="export PATH=\"$INSTALL_DIR:\$PATH\""
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path $INSTALL_DIR" ;;
    *) rc="$HOME/.profile" ;;
  esac
  if ! grep -qs "$INSTALL_DIR" "$rc"; then
    mkdir -p "$(dirname "$rc")"
    printf '\n# Digidropp CLI\n%s\n' "$line" >> "$rc"
    say "  Added $INSTALL_DIR to your PATH in $rc"
  fi
  say ""
  say "Open a new terminal (or run: $line), then:"
else
  say ""
  say "Next:"
fi
say "  digidropp login     # once, with a token from Digidropp → CI & tokens"
say "  digidropp           # in your app's folder: build, upload, get a link + QR code"
