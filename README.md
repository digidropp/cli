# Digidropp CLI

Build your Android app and get an install link + QR code, right from the terminal.

```bash
curl -fsSL https://digidropp.online/install.sh | sh      # macOS / Linux
irm https://digidropp.online/install.ps1 | iex           # Windows (PowerShell)
```

No Node.js needed: the installer downloads a standalone program for your system, checks its SHA-256 checksum, puts
it in `~/.digidropp/bin`, and adds that folder to your PATH.

## Usage

```bash
digidropp login                      # once: paste a token from Digidropp → CI & tokens
digidropp                            # in your app's folder: build, upload, print link + QR code
digidropp upload app-release.apk     # upload a build you made yourself (.apk or .ipa)
digidropp apps                       # list your apps and install links
digidropp -m "Fixed checkout"        # add release notes
```

`digidropp` detects the project and builds it with your own tools:

| Project | Build command |
|---|---|
| Flutter | `flutter build apk --release` |
| React Native (with `android/`) | `./gradlew assembleRelease` in `android/` |
| Expo | `npx expo prebuild --platform android` then `./gradlew assembleRelease` |
| Android (Gradle) | `./gradlew assembleDebug` |

In CI or for AI agents, set `DIGIDROPP_TOKEN` instead of logging in.

## Development

```bash
bun install
node src/index.js --help          # run from source (Node 20+ or Bun)
sh scripts/build.sh               # standalone binaries for all platforms → dist/
```

## Releasing

1. Bump the version in `package.json` **and** `VERSION` in `src/index.js`.
2. `git tag v0.1.1 && git push origin v0.1.1`

`.github/workflows/release.yml` builds every platform and attaches the files and `checksums.txt` to a GitHub release.
`install.sh` and `install.ps1` always fetch the latest release, so no change to digidropp.online is needed.

**The installers are served from the website:** copies of `install.sh` and `install.ps1` live in the frontend's
`public/` folder. When you change them here, copy them there too.
