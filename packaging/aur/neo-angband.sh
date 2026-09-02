#!/bin/sh

# The upstream AppImage is intentionally portable and would otherwise put data
# beside itself. A pacman-owned /opt directory is not writable by the player, so
# give this system-wide install a normal per-user home while retaining an
# explicit override for portable/custom setups.
if [ -z "${NEO_ANGBAND_DATA:-}" ]; then
  export NEO_ANGBAND_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/neo-angband"
fi

exec /opt/neo-angband/neo-angband.AppImage "$@"
