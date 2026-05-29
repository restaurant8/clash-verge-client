# macOS Build Guide

This package is a macOS-ready source snapshot for MuaCloud. It intentionally does not include `node_modules`, Rust `target`, Windows `.exe` resources, or generated sidecar binaries. The macOS sidecars and resources are prepared on the Mac by `scripts/prebuild.mjs`.

## Requirements

- macOS 11 or newer.
- Xcode Command Line Tools:

```bash
xcode-select --install
```

- Node.js 24.x and pnpm 11.3.0:

```bash
corepack enable
corepack prepare pnpm@11.3.0 --activate
```

- Rust 1.95:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup toolchain install 1.95.0
rustup default 1.95.0
```

## Build On The Current Mac

From the project root:

```bash
bash scripts/macos-build.sh
```

The script detects the current Mac architecture:

- Apple Silicon: `aarch64-apple-darwin`
- Intel Mac: `x86_64-apple-darwin`

The DMG will be generated in:

```text
target/<target>/release/bundle/dmg/
```

## Build A Specific Architecture

Apple Silicon:

```bash
bash scripts/macos-build.sh aarch64-apple-darwin
```

Intel:

```bash
bash scripts/macos-build.sh x86_64-apple-darwin
```

Build both Apple Silicon and Intel DMGs:

```bash
bash scripts/macos-build.sh both
```

When building Intel packages on Apple Silicon, the helper script automatically installs and exports x86 OpenSSL if Homebrew is available under Rosetta. If you want to do it manually:

```bash
arch -x86_64 brew install openssl@3
export OPENSSL_DIR="$(brew --prefix openssl@3)"
export OPENSSL_INCLUDE_DIR="$OPENSSL_DIR/include"
export OPENSSL_LIB_DIR="$OPENSSL_DIR/lib"
export PKG_CONFIG_PATH="$OPENSSL_DIR/lib/pkgconfig"
```

## Manual Commands

If you do not want to use the helper script:

```bash
pnpm install
rustup target add aarch64-apple-darwin --toolchain 1.95.0
pnpm run prebuild aarch64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin -b dmg
```

For Intel, replace `aarch64-apple-darwin` with `x86_64-apple-darwin`.

## Signing And Notarization

The current local config uses:

```json
"signingIdentity": null
```

So a local build can produce an unsigned or ad-hoc signed DMG for testing. For public distribution, use an Apple Developer ID certificate and notarization. The CI workflow already expects these secrets when signing is enabled:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## Common Issues

- If sidecar files are missing, rerun:

```bash
pnpm run prebuild aarch64-apple-darwin
```

- If a download from GitHub fails, set a proxy and rerun:

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

- If macOS blocks the unsigned app, right-click the app and choose Open for local testing.
