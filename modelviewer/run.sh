#!/usr/bin/env bash
# 3DMigoto Mod Viewer — Linux/macOS launch script
# Automatically creates venv and installs dependencies on first run.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/.venv"
PYTHON="${VENV}/bin/python"
PIP="${PYTHON} -m pip"
REQ="$SCRIPT_DIR/requirements.txt"

# --- Create venv if missing ---
if [ ! -f "$PYTHON" ]; then
    echo "[setup] Creating virtual environment..."
    python3 -m venv "$VENV"
fi

# --- Install/update dependencies ---
if [ ! -f "$VENV/.deps_installed" ] || [ "$REQ" -nt "$VENV/.deps_installed" ]; then
    echo "[setup] Installing dependencies..."
    "$PIP" install --quiet -r "$REQ"

    # PyQt6 for pywebview (Linux/macOS)
    "$PIP" install --quiet PyQt6 PyQt6-WebEngine qtpy

    "$PYTHON" -c "
import sys; sys.path.insert(0, '$SCRIPT_DIR/src')
from app.settings.paths import has_vendored_three
assert has_vendored_three()
" && touch "$VENV/.deps_installed"
    echo "[setup] Done."
fi

# --- Launch ---
export QTWEBENGINE_CHROMIUM_FLAGS="--ignore-gpu-blocklist --disable-gpu-sandbox --enable-gpu-rasterization"
exec "$PYTHON" "$SCRIPT_DIR/src/viewer_app.py" "$@"
