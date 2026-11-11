#!/usr/bin/env bash
# ==============================================================================
# AMV Maker - Sidecar Bundler Script
# Packages or links the Python engine into app/src-tauri/binaries/amv-engine-$TARGET
# for Tauri sidecar distribution.
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BINARIES_DIR="$PROJECT_ROOT/app/src-tauri/binaries"

mkdir -p "$BINARIES_DIR"

# 1. Determine Target Architecture Triple
if [ -n "$1" ]; then
    TARGET="$1"
elif [ -n "$TARGET" ]; then
    TARGET="$TARGET"
else
    # Auto-detect target triple
    OS="$(uname -s)"
    ARCH="$(uname -m)"

    case "$OS" in
        Darwin)
            case "$ARCH" in
                arm64) TARGET="aarch64-apple-darwin" ;;
                x86_64) TARGET="x86_64-apple-darwin" ;;
                *) echo "Unknown Darwin arch: $ARCH" >&2; exit 1 ;;
            esac
            ;;
        Linux)
            case "$ARCH" in
                x86_64) TARGET="x86_64-unknown-linux-gnu" ;;
                aarch64) TARGET="aarch64-unknown-linux-gnu" ;;
                *) echo "Unknown Linux arch: $ARCH" >&2; exit 1 ;;
            esac
            ;;
        MINGW*|MSYS*|CYGWIN*)
            TARGET="x86_64-pc-windows-msvc"
            ;;
        *)
            echo "Unsupported operating system: $OS" >&2
            exit 1
            ;;
    esac
fi

echo "======================================================================"
echo "AMV Maker Sidecar Bundler"
echo "Target Triple: $TARGET"
echo "Binaries Dir:  $BINARIES_DIR"
echo "======================================================================"

SOURCE_WRAPPER="$BINARIES_DIR/amv-engine"
TARGET_BINARY="$BINARIES_DIR/amv-engine-$TARGET"

# Ensure primary wrapper exists
if [ ! -f "$SOURCE_WRAPPER" ]; then
    echo "Creating primary sidecar wrapper at $SOURCE_WRAPPER..."
    cat << 'EOF' > "$SOURCE_WRAPPER"
#!/usr/bin/env bash
set -eo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../../engine/main.py" ]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
elif [ -f "$SCRIPT_DIR/../../engine/main.py" ]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
elif [ -f "$SCRIPT_DIR/engine/main.py" ]; then
    PROJECT_ROOT="$SCRIPT_DIR"
elif [ -n "$AMV_ENGINE_ROOT" ] && [ -f "$AMV_ENGINE_ROOT/engine/main.py" ]; then
    PROJECT_ROOT="$AMV_ENGINE_ROOT"
else
    PROJECT_ROOT="$(pwd)"
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -x "$PROJECT_ROOT/engine/.venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_ROOT/engine/.venv/bin/python"
elif [ -n "$VIRTUAL_ENV" ] && [ -x "$VIRTUAL_ENV/bin/python" ]; then
    PYTHON_BIN="$VIRTUAL_ENV/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
else
    PYTHON_BIN="python"
fi
export PYTHONPATH="$PROJECT_ROOT:${PYTHONPATH:-}"
exec "$PYTHON_BIN" "$PROJECT_ROOT/engine/main.py" "$@"
EOF
fi

chmod +x "$SOURCE_WRAPPER"

# Create target-specific binary / wrapper (or symlink)
echo "Linking target binary to $TARGET_BINARY..."
cp -f "$SOURCE_WRAPPER" "$TARGET_BINARY"
chmod +x "$TARGET_BINARY"

echo "Verifying sidecar execution..."
"$TARGET_BINARY" --help > /dev/null

echo "✓ Sidecar successfully bundled and verified for $TARGET!"
ls -la "$BINARIES_DIR"
