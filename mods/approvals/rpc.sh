#!/bin/sh
set -eu
printf '%s\n' '{"jsonrpc":"2.0","id":0,"method":"hello","params":{"generation":1}}' "$1" | hc connect
