#!/bin/sh

has_pnpm() {
  command -v pnpm >/dev/null 2>&1 || command -v pnpm.cmd >/dev/null 2>&1
}

if command -v node >/dev/null 2>&1 && has_pnpm; then
  return 0
fi

# Codex Desktop keeps its workspace Node and pnpm runtimes outside the normal
# GUI PATH. GUI clients may omit HOME, so also derive it from USERPROFILE.
windows_home=''
if [ -n "${USERPROFILE:-}" ]; then
  if command -v cygpath >/dev/null 2>&1; then
    windows_home="$(cygpath -u "$USERPROFILE")"
  else
    windows_home="$(printf '%s' "$USERPROFILE" | sed 's#\\#/#g')"
  fi
fi

# GUI git hooks often run with neither HOME nor USERPROFILE set, so also derive
# the home from the current user name and, as a last resort, scan every user
# profile on every drive for the bundled Codex runtime.
current_user="$(id -un 2>/dev/null || whoami 2>/dev/null)"
current_user="${current_user##*\\}"

# Unmatched globs stay literal (no nullglob in POSIX sh); the -x/-f tests below
# simply fail for those, so listing extra candidate locations is harmless.
found=''
for dependencies_dir in \
  "${HOME:-}"/.cache/codex-runtimes/*/dependencies \
  "$windows_home"/.cache/codex-runtimes/*/dependencies \
  /c/Users/"$current_user"/.cache/codex-runtimes/*/dependencies \
  /?/Users/*/.cache/codex-runtimes/*/dependencies; do
  node_bin="$dependencies_dir/node/bin"
  pnpm_bin="$dependencies_dir/bin"

  if [ -x "$node_bin/node.exe" ] && [ -f "$pnpm_bin/pnpm.cmd" ]; then
    PATH="$node_bin:$pnpm_bin:$PATH"
    export PATH
    # Trust the located runtime directly: pnpm.cmd ships without a unix execute
    # bit, so `command -v pnpm.cmd` can't see it under git-bash even though
    # Windows runs it fine (cargo-make resolves it via PATHEXT).
    found=1
    break
  fi
done

if { command -v node >/dev/null 2>&1 && has_pnpm; } || [ -n "$found" ]; then
  return 0
fi

echo "❌ Node.js and pnpm are required for Git hooks."
echo "Install pnpm globally or add Node.js and pnpm to your user PATH."
return 1
