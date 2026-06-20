#!/usr/bin/env bash
# Run a steve race FROM THIS MACHINE against the remote Minecraft server.
#
# The bot "brain" (pathfinding, crafting, decisions) runs locally on whatever
# box you invoke this from. Only the Minecraft *world* is remote. Race data is
# logged to the shared Postgres (DATABASE_URL in .env), which the eye-of-steve
# dashboard reads — so the dashboard can run anywhere too.
#
# All connection + DB config lives in .env (loaded via `node --env-file`):
#   MC_HOST, MC_PORT, MC_RCON_PORT, MC_RCON_PASS, MC_VERSION, DATABASE_URL
#
# It never wipes the world or touches the server — it only drives bots over the
# network. Overrides: BOTS (default 4), TIMEOUT seconds (default 1800 = 30 min).
set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f .env ]; then
	echo "error: .env not found (copy .env.example and fill in MC_HOST + DATABASE_URL)" >&2
	exit 1
fi

# Stop any race bots still running on THIS machine so we never double-drive the
# world (two brains fighting over the same bots silently halves throughput).
echo "stopping any local race procs..."
pkill -f "src/main.ts" 2>/dev/null || true
sleep 1
pkill -9 -f "src/main.ts" 2>/dev/null || true

getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"'; }
HOST="$(getenv MC_HOST)"
RCON_HOST="$(getenv MC_RCON_HOST)"
RCON_PORT="$(getenv MC_RCON_PORT)"
RCON_PORT="${RCON_PORT:-25575}"
SSH_USER="${SSH_USER:-bridger}"

# RCON is firewalled to the server's localhost, so tunnel it. If MC_RCON_HOST is
# a loopback address and nothing is listening locally yet, open an SSH tunnel
# (localhost:RCON_PORT -> server localhost:RCON_PORT) in the background.
case "$RCON_HOST" in
	127.0.0.1 | localhost | ::1)
		if ! nc -z 127.0.0.1 "$RCON_PORT" 2>/dev/null; then
			echo "opening RCON SSH tunnel: localhost:${RCON_PORT} -> ${SSH_USER}@${HOST}:${RCON_PORT}"
			ssh -f -N -L "${RCON_PORT}:localhost:${RCON_PORT}" "${SSH_USER}@${HOST}" || {
				echo "error: failed to open RCON tunnel" >&2
				exit 1
			}
			sleep 1
		fi
		;;
esac

BOTS="${BOTS:-4}"
TIMEOUT="${TIMEOUT:-1800}"

echo "launching race: ${BOTS} bots, ${TIMEOUT}s, against ${HOST:-<MC_HOST unset>}"
exec node --env-file=.env src/main.ts --bots "$BOTS" --timeout "$TIMEOUT"
