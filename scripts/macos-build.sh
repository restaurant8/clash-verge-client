#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required. Run: corepack enable && corepack prepare pnpm@11.3.0 --activate"
  exit 1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "rustup is required. Install Rust first: https://rustup.rs/"
  exit 1
fi

REQUESTED_TARGET="${1:-}"
if [[ -z "$REQUESTED_TARGET" ]]; then
  case "$(uname -m)" in
    arm64) TARGETS=("aarch64-apple-darwin") ;;
    x86_64) TARGETS=("x86_64-apple-darwin") ;;
    *)
      echo "Unsupported Mac architecture: $(uname -m)"
      exit 1
      ;;
  esac
elif [[ "$REQUESTED_TARGET" == "both" || "$REQUESTED_TARGET" == "all" ]]; then
  TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin")
else
  TARGETS=("$REQUESTED_TARGET")
fi

for TARGET in "${TARGETS[@]}"; do
  if [[ "$TARGET" != "aarch64-apple-darwin" && "$TARGET" != "x86_64-apple-darwin" ]]; then
    echo "Unsupported target: $TARGET"
    echo "Use aarch64-apple-darwin, x86_64-apple-darwin, or both."
    exit 1
  fi
done

export NODE_OPTIONS="${NODE_OPTIONS:---max_old_space_size=4096}"

echo "==> Installing frontend dependencies"
pnpm install

for TARGET in "${TARGETS[@]}"; do
  if [[ "$TARGET" == "x86_64-apple-darwin" && "$(uname -m)" == "arm64" ]]; then
    if ! arch -x86_64 brew --prefix openssl@3 >/dev/null 2>&1; then
      echo "==> Installing x86 OpenSSL for Intel macOS build"
      arch -x86_64 brew install openssl@3
    fi
    OPENSSL_PREFIX="$(arch -x86_64 brew --prefix openssl@3)"
    export OPENSSL_DIR="$OPENSSL_PREFIX"
    export OPENSSL_INCLUDE_DIR="$OPENSSL_PREFIX/include"
    export OPENSSL_LIB_DIR="$OPENSSL_PREFIX/lib"
    export PKG_CONFIG_PATH="$OPENSSL_PREFIX/lib/pkgconfig"
  fi

  echo "==> Installing Rust target: $TARGET"
  rustup target add "$TARGET" --toolchain 1.95.0 || rustup target add "$TARGET"

  echo "==> Preparing macOS sidecars and resources: $TARGET"
  pnpm run prebuild "$TARGET"

  echo "==> Building macOS DMG: $TARGET"
  pnpm tauri build --target "$TARGET" -b dmg

  echo "==> DMG output: target/$TARGET/release/bundle/dmg/"
done

echo "==> Done"
