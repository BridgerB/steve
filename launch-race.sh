#!/usr/bin/env bash
# Launch a steve race into the EXISTING world.
# NEVER wipes the world or restarts the MC server — Bridger resets the world
# MANUALLY and only he does it. Two agents (steve + ruststeve) share this box;
# auto-wipes destroyed each other's races. (See memory: never-wipe-shared-world)
set -u
echo "killing ONLY my own steve race procs (not the world, not ruststeve)..."
pkill -f "src/main.ts" 2>/dev/null || true
sleep 2
pkill -9 -f "src/main.ts" 2>/dev/null || true
sleep 1
echo "surviving steve race procs: $(pgrep -f 'src/main.ts' | wc -l)"
echo "clearing steve race-log DB in-place (a log file — does NOT touch the world)..."
sqlite3 /home/bridger/Developer/steve/data/steve.db "DELETE FROM events; DELETE FROM ticks; DELETE FROM inventory_snapshots; DELETE FROM races;" 2>/dev/null || true
cd /home/bridger/Developer/steve || exit 1
echo "setting keep_inventory (gamerule via RCON — NOT a server restart)..."
node src/set-gamerules.ts 2>&1 | tail -1
BOTS="${BOTS:-2}"; TIMEOUT="${TIMEOUT:-7200}"
nohup node src/main.ts --bots "$BOTS" --timeout "$TIMEOUT" > /tmp/race.log 2>&1 < /dev/null &
disown
sleep 1
echo "RACE LAUNCHED into existing world (bots=$BOTS timeout=${TIMEOUT}s) pid $!"
