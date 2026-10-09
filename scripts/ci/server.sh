#!/usr/bin/env bash
# Runner Minecraft server (cycle 7). Same properties as local-server.sh (difficulty normal,
# online-mode false, view 6, simulation 4, 6 GB heap, the box's JVM flags), bound to
# 127.0.0.1 with a per-job RCON password.
#
#   scripts/ci/server.sh start <env-dir> <world-dir>   # writes server.properties, starts, waits for RCON
#   scripts/ci/server.sh stop                          # RCON stop, waits for the process to exit
#
# Needs RUNNER_RCON_PASS in the environment; ports RUNNER_MC_PORT (25565), RUNNER_RCON_PORT (25575).
set -eu
CMD=$1
MC_PORT=${RUNNER_MC_PORT:-25565}
RCON_PORT=${RUNNER_RCON_PORT:-25575}
: "${RUNNER_RCON_PASS:?RUNNER_RCON_PASS must be set}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NODE=${NODE_BIN:-node}

rcon() { GYM_SERVER=runner "$NODE" --import "$ROOT/typecraft-resolve.mjs" "$ROOT/scripts/rcon.ts" "$@"; }

case "$CMD" in
start)
	ENV_DIR=$2
	WORLD=$3
	mkdir -p "$WORLD"
	cd "$WORLD"
	echo "eula=true" > eula.txt
	cat > server.properties <<PROPS
max-players=100
online-mode=false
pvp=false
difficulty=normal
gamemode=survival
enable-command-block=true
spawn-protection=0
view-distance=6
simulation-distance=4
server-port=$MC_PORT
server-ip=127.0.0.1
level-seed=${LEVEL_SEED:-typecraft}
level-type=minecraft:normal
generate-structures=true
motd=steve runner gym
white-list=false
spawn-monsters=true
spawn-animals=true
spawn-npcs=true
allow-flight=true
rate-limit=0
enable-rcon=true
rcon.password=$RUNNER_RCON_PASS
rcon.port=$RCON_PORT
broadcast-rcon-to-ops=true
PROPS
	nohup "$ENV_DIR/jre/bin/java" -Xms1G -Xmx${HEAP_MB:-6144}M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
		-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 \
		-XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 \
		-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 \
		-XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -jar "$ENV_DIR/server-26.1.2.jar" nogui \
		< /dev/null > "$WORLD/server.log" 2>&1 &
	echo $! > "$WORLD/server.pid"
	T0=$(date +%s)
	until rcon "list" > /dev/null 2>&1; do
		if [ $(( $(date +%s) - T0 )) -gt 120 ]; then
			echo "server did not answer RCON within 120 s"
			tail -40 "$WORLD/server.log"
			exit 1
		fi
		if ! kill -0 "$(cat "$WORLD/server.pid")" 2>/dev/null; then
			echo "server exited"
			tail -40 "$WORLD/server.log"
			exit 1
		fi
		sleep 2
	done
	echo "server up in $(( $(date +%s) - T0 )) s (pid $(cat "$WORLD/server.pid"))"
	;;
stop)
	WORLD=${2:-}
	rcon "stop" || true
	if [ -n "$WORLD" ] && [ -f "$WORLD/server.pid" ]; then
		PID=$(cat "$WORLD/server.pid")
		for _ in $(seq 1 60); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
		kill -9 "$PID" 2>/dev/null || true
	fi
	echo "server stopped"
	;;
*)
	echo "usage: $0 start <env-dir> <world-dir> | stop [world-dir]" >&2
	exit 2
	;;
esac
