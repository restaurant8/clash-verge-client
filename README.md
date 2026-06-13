# MuaCloud Client

MuaCloud desktop client for Windows and macOS, built with Tauri, React, TypeScript, Rust, and Mihomo-compatible local proxy support.

## Development

Read `docs/CLIENT_CONTRACT.md` before changing startup, authentication, subscription, checkout, entitlement, API failover, or remote configuration behavior.

Useful local commands:

```bash
pnpm install --frozen-lockfile
pnpm run web:build
pnpm tauri build
```

## Release

The project release workflow is `.github/workflows/muacloud-release-desktop.yml`.

It builds Windows and macOS desktop artifacts and uploads them to a GitHub draft Release. Optional Telegram upload support is intentionally disabled by default.
