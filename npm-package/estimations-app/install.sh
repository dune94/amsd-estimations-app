#!/usr/bin/env bash
# estimations-app installer. Fetches the code, installs dependencies, creates a private .env (and a backup copy), installs the
# memory-cap script and verifies with the quick tests. Run it directly or through the npm wrapper (same flags):
#
#   bash install.sh --repo <git URL or local checkout> --dest ./estimations-app            install
#   bash install.sh --dest ./estimations-app --check    verify an existing install, change nothing
#   bash install.sh --dest ./estimations-app --uninstall remove an install made by this script (env backups are kept)
#
# Flags: --dest DIR  --repo URL|PATH (required: a git URL, or a local checkout whose tracked + untracked-not-ignored files are copied)
#        --ref BRANCH  --yes (no prompts)  --no-verify  --backup-dir DIR (default ~/.env-backups)
#        --search DIR (where to look for the codelines root; scope only)
#        --env-from FILE (copy the real values from this .env for every key in .env.example, after install and BEFORE the verify
#                         tests; installer-managed keys are kept; prints key names only, never values)
# Every heavy step runs under bin/bounded (memory cap). Nothing is installed outside --dest except the .env backup copy.
set -uo pipefail

NAME="estimations-app"; KIND="node"; REPO_URL=""
DEST=""; ENV_FROM=""; REF="main"; CHECK=0; UNINSTALL=0; YES=0; VERIFY=1; BACKUP_DIR="$HOME/.env-backups"; SEARCH=""
FAILED=0
_ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
_bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILED=1; }
_warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
_step() { printf '\n== %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dest)       DEST="${2:-}"; shift 2 ;;
    --repo)       REPO_URL="${2:-}"; shift 2 ;;
    --ref)        REF="${2:-}"; shift 2 ;;
    --yes)        YES=1; shift ;;
    --no-verify)  VERIFY=0; shift ;;
    --backup-dir) BACKUP_DIR="${2:-}"; shift 2 ;;
    --search)     SEARCH="${2:-}"; shift 2 ;;
    --env-from)   ENV_FROM="${2:-}"; shift 2 ;;
    --check)      CHECK=1; shift ;;
    --uninstall)  UNINSTALL=1; shift ;;
    --)           shift ;;   # npm 11 passes the separator on to the script
    -h|--help)    sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[ -n "$DEST" ] || DEST="./$NAME"
if [ "$CHECK" = 0 ] && [ "$UNINSTALL" = 0 ] && [ -z "$REPO_URL" ]; then echo "--repo is required for an install (git URL or local checkout path)" >&2; exit 2; fi
mkdir -p "$(dirname "$DEST")" && DEST="$(cd "$(dirname "$DEST")" && pwd)/$(basename "$DEST")"
MARKER="$DEST/.install-marker"; BOUNDED_BIN="$DEST/bin/bounded"

capped() {   # capped <MB> <command...>: run under the memory cap, or say plainly that none is available
  local mb="$1"; shift
  if [ -x "$BOUNDED_BIN" ] && command -v systemd-run >/dev/null 2>&1; then "$BOUNDED_BIN" --want "$mb" -- "$@"
  else _warn "no memory cap available here (needs systemd-run); running uncapped: $1"; "$@"; fi
}
have() { command -v "$1" >/dev/null 2>&1; }

need() {     # need <cmd> <why>: hard requirement
  if have "$1"; then _ok "$1 ($($1 --version 2>&1 | head -1))"; else _bad "$1 missing — $2"; fi
}
want() {     # want <cmd> <why>: needed at run time, reported not installed
  if have "$1"; then _ok "$1"; else _warn "$1 not on PATH — $2"; fi
}

check_tools() {
  _step "Tools"
  need git "the code is fetched with it"
  if [ "$KIND" = python ]; then
    need python3 "the engine is python"
    python3 -c 'import venv, ensurepip' 2>/dev/null && _ok "python3 venv" || _bad "python3 venv/ensurepip missing — install python3-venv"
    want rg "the codeline search (ripgrep)"; want codegraph "code indexing for the investigation step"; want claude "the agent calls"
  else
    need node "the app is node"; need npm "dependencies"
    local major; major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
    [ "$major" -ge 20 ] && _ok "node >= 20" || _bad "node $major is too old (>= 20 needed)"
    want claude "only for the optional LLM deep-dive"
  fi
  have systemd-run && _ok "systemd-run (memory cap)" || _warn "systemd-run missing — steps will run without a memory cap"
}

detect_codelines() {   # the directory under the search roots holding the most git checkouts (needs at least 3)
  local best="" bestn=2 d n r roots=()
  if [ -n "$SEARCH" ]; then roots+=("$SEARCH"); else roots+=("$(dirname "$DEST")" "$HOME/projects" "$HOME"); fi
  for r in "${roots[@]}"; do
    [ -d "$r" ] || continue
    for d in "$r" "$r"/*/; do
      d="${d%/}"; [ -d "$d" ] || continue
      n=$(find "$d" -mindepth 2 -maxdepth 2 -name .git 2>/dev/null | wc -l)
      if [ "$n" -gt "$bestn" ]; then best="$d"; bestn=$n; fi
    done
  done
  echo "$best"
}

setenv() {   # setenv KEY VALUE: set a key in DEST/.env
  local f="$DEST/.env" t; t=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {print k"="v; found=1; next} {print} END{if(!found) print k"="v}' "$f" > "$t" && cat "$t" > "$f"; rm -f "$t"
}
getenv_() { grep -E "^$1=" "$DEST/.env" 2>/dev/null | head -1 | cut -d= -f2-; }

merge_env_from() {   # copy real values (non-empty in FILE) over the .env.example defaults; never prints a value
  local src="$1" k v
  [ -f "$src" ] || { _bad "--env-from file not found: $src"; return; }
  for k in $(grep -E '^[A-Z_]+=' .env.example | cut -d= -f1); do
    [ "$k" = SCOPE_BOUNDED ] && continue          # managed by the installer (this install's own bin/bounded)
    v=$(grep -E "^$k=" "$src" | head -1 | cut -d= -f2-)
    [ -n "$v" ] && { setenv "$k" "$v"; _ok "$k copied from $(basename "$(dirname "$src")")/$(basename "$src")"; }
  done
}

backup_env() {
  local ts; ts=$(date +%Y%m%dT%H%M%S)
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR" && cp -p "$DEST/.env" "$BACKUP_DIR/$NAME.env.$ts" && chmod 600 "$BACKUP_DIR/$NAME.env.$ts" \
    && _ok ".env backup copy: $BACKUP_DIR/$NAME.env.$ts" || _bad "could not back up .env to $BACKUP_DIR"
}

# ── check / uninstall ───────────────────────────────────────────────────────────────────────────────────────────────────
if [ "$UNINSTALL" = 1 ]; then
  _step "Uninstall $DEST"
  [ -f "$MARKER" ] || { _bad "$DEST is not an install made by this script (no .install-marker marker) — nothing removed"; exit 1; }
  rm -rf "$DEST" && _ok "removed $DEST" || _bad "could not remove $DEST"
  _warn "env backups are kept in $BACKUP_DIR"; exit "$FAILED"
fi

if [ "$CHECK" = 1 ]; then
  check_tools
  _step "Install at $DEST"
  [ -f "$MARKER" ] && _ok "installed by this script ($(head -1 "$MARKER"))" || _bad "no install found (missing .install-marker)"
  if [ -f "$DEST/.env" ]; then
    [ "$(stat -c %a "$DEST/.env")" = 600 ] && _ok ".env permissions 600" || _bad ".env permissions are not 600"
    grep -E '^[A-Z_]+=$' "$DEST/.env" | cut -d= -f1 | sed 's/^/    blank in .env: /'
  else _bad ".env missing"; fi
  [ -x "$BOUNDED_BIN" ] && _ok "bin/bounded" || _bad "bin/bounded missing"
  if [ "$KIND" = python ]; then
    [ -x "$DEST/.venv/bin/python" ] && "$DEST/.venv/bin/python" -c 'import yaml, requests, jsonschema, pymupdf, docx, pptx' 2>/dev/null \
      && _ok "python dependencies" || _bad "python dependencies missing — run the installer"
    r=$(getenv_ SCOPE_CODELINES_ROOT); [ -n "$r" ] && [ -d "$r" ] && _ok "codelines root $r" || _warn "SCOPE_CODELINES_ROOT is blank or not a directory"
  else
    [ -d "$DEST/node_modules" ] && _ok "node_modules" || _bad "node_modules missing — run the installer"
    [ -f "$DEST/dist/server.js" ] && _ok "built (dist/server.js)" || _bad "not built — run the installer"
  fi
  [ "$FAILED" = 0 ] && echo "check passed" || echo "check FAILED"; exit "$FAILED"
fi

# ── install ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
check_tools
[ "$FAILED" = 0 ] || { echo; echo "Fix the ✗ items above and run again."; exit 1; }

_step "Fetch the code into $DEST"
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && [ ! -f "$MARKER" ]; then _bad "$DEST exists and is not empty"; exit 1; fi
if [ -d "$REPO_URL" ]; then   # local checkout: copy what git would commit, nothing ignored
  mkdir -p "$DEST" && (cd "$REPO_URL" && git ls-files --cached --others --exclude-standard -z | tar --null -T - -cf -) | tar -xf - -C "$DEST" \
    && _ok "copied from $REPO_URL" || { _bad "copy failed"; exit 1; }
else
  [ -d "$DEST/.git" ] && { git -C "$DEST" pull --ff-only -q && _ok "updated existing checkout"; } || \
  { git clone -q --depth 1 --branch "$REF" "$REPO_URL" "$DEST" && _ok "cloned $REPO_URL ($REF)" || { _bad "clone failed: $REPO_URL"; exit 1; }; }
fi
chmod +x "$DEST/bin/bounded" 2>/dev/null; [ -x "$BOUNDED_BIN" ] && _ok "bin/bounded" || _bad "bin/bounded missing from the checkout"

_step "Dependencies"
cd "$DEST" || exit 1
if [ "$KIND" = python ]; then
  capped 1024 python3 -m venv .venv && _ok "virtual environment" || _bad "venv failed"
  capped 1536 .venv/bin/pip install -q -r requirements.txt && _ok "python packages (requirements.txt)" || _bad "pip install failed"
else
  capped 2048 npm ci --no-audit --no-fund --loglevel=error && _ok "npm ci" || _bad "npm ci failed"
  capped 2048 npm run build --silent && _ok "npm run build" || _bad "build failed"
fi
[ "$FAILED" = 0 ] || { echo; echo "Install stopped: see ✗ above."; exit 1; }

_step "Environment file"
if [ -f .env ]; then _ok ".env already exists — left unchanged"
else
  cp .env.example .env && chmod 600 .env && _ok ".env created from .env.example (permissions 600)"
  for k in $(grep -E '^[A-Z_]+=$' .env | cut -d= -f1); do   # values already exported in the environment are used as they are
    v="${!k:-}"; [ -n "$v" ] && setenv "$k" "$v" && _ok "$k taken from the environment"
  done
  if [ "$KIND" = python ]; then
    setenv SCOPE_BOUNDED "$BOUNDED_BIN"; _ok "SCOPE_BOUNDED=$BOUNDED_BIN"
    root=$(detect_codelines)
    if [ -n "$root" ]; then setenv SCOPE_CODELINES_ROOT "$root"; _ok "codelines root detected: $root"
    else _warn "no folder with several git checkouts found — set SCOPE_CODELINES_ROOT in .env (or pass --search DIR)"; fi
    mkdir -p config.local && _ok "config.local/ (organisation-specific settings; keep it private and backed up)"
  fi
  if [ "$YES" = 0 ] && [ -t 0 ]; then   # prompt for what is still blank
    for k in $(grep -E '^[A-Z_]+=$' .env | cut -d= -f1); do
      case "$k" in *TOKEN*|*KEY*|*SECRET*) read -r -s -p "  $k (hidden, Enter to skip): " v; echo ;; *) read -r -p "  $k (Enter to skip): " v ;; esac
      [ -n "$v" ] && setenv "$k" "$v"
    done
  fi
  blank=$(grep -E '^[A-Z_]+=$' .env | cut -d= -f1 | tr '\n' ' '); [ -n "$blank" ] && _warn "still blank in .env: $blank"
fi
[ -n "$ENV_FROM" ] && { _step "Real .env values (before testing)"; merge_env_from "$ENV_FROM"; blank=$(grep -E '^[A-Z_]+=$' .env | cut -d= -f1 | tr '\n' ' '); [ -n "$blank" ] && _warn "still blank after copy: $blank"; }
backup_env

if [ "$VERIFY" = 1 ]; then
  _step "Verify (quick tests)"
  if [ "$KIND" = python ]; then
    capped 1024 timeout 120 .venv/bin/python -m pytest -q -p no:cacheprovider tests 2>&1 | tail -3; [ "${PIPESTATUS[0]}" = 0 ] && _ok "tests passed" || _bad "tests failed"
  else
    capped 2048 timeout 120 npx vitest run 2>&1 | grep -E "Test Files|Tests " ; [ "${PIPESTATUS[0]}" = 0 ] && _ok "tests passed" || _bad "tests failed"
  fi
fi

printf '%s\ninstalled %s from %s (%s)\n' "$NAME" "$(date -u +%FT%TZ)" "$REPO_URL" "$REF" > "$MARKER"
_step "Done"
echo "  folder:  $DEST"; echo "  env:     $DEST/.env  (private; backup copy in $BACKUP_DIR)"
echo "  check:   bash $0 --dest $DEST --check"
[ "$FAILED" = 0 ] && exit 0 || exit 1
