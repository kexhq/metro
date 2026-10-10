#!/bin/sh
# One-time setup after generating or cloning the app.
set -eu
cd "$(dirname "$0")/.."

# Tey looks for modules in src/ only; the app keeps them at the root, so src
# is a link to it. An empty src/ left by `tey init` makes way for the link.
if [ -d src ] && [ ! -L src ]; then rmdir src; fi
[ -e src ] || ln -s . src

tey install --approve-plugins
sh script/setup-odbc.sh db/odbc
echo "Ready: tey server"
