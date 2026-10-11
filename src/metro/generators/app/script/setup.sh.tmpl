#!/bin/sh
# One-time setup after generating or cloning the app.
set -eu
cd "$(dirname "$0")/.."

# The app keeps its modules at its top (package.kex: sources([...])). An
# empty src/ left by `tey init`, or the link older setups made, is not needed.
if [ -L src ]; then rm src; elif [ -d src ]; then rmdir src 2>/dev/null || true; fi

tey install --approve-plugins
sh script/setup-odbc.sh db/odbc
echo "Ready: tey server"
