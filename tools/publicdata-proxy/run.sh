#!/bin/zsh
# Starts the public-data proxy with the keys kept outside the repository.
S=${0:A:h:h:h:h}/.secrets
set -a
. "$S/datagokr.env"
. "$S/safemap.env"
set +a
source /Volumes/Transcend/devtools/env.sh
exec node ${0:A:h}/server.mjs
