#!/usr/bin/env bash
# Local gym server (cycle 6, decision 4): a vanilla 26.1.2 server on the Mac, so steve's gyms
# never load the shared box (Server A is for races only). Same jar as
# server/oci/steve/configuration.nix (Mojang piston-data, sha1-checked), Java 25 from nixpkgs, the
# box's JVM flags, the box's server.properties except difficulty=normal, the ports and a 6 GB heap.
#
#   ./local-server.sh        # local-1: game 25569, RCON 25579, world in data/local-world
#   ./local-server.sh 2      # local-2: game 25570, RCON 25580, world in data/local-world-2
#
# ruststeve uses 25567/25577 and 25568/25578 locally. Runs in the foreground; launch it
# detached (nohup) and stop it with RCON `stop`. The local world is ours to reset: delete
# data/local-world* while the server is down.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
N=${1:-1}
case "$N" in
  1) PORT=25569 RCON_PORT=25579 WORLD=$DIR/data/local-world ;;
  2) PORT=25570 RCON_PORT=25580 WORLD=$DIR/data/local-world-2 ;;
  *) echo "usage: $0 [1|2]" >&2; exit 2 ;;
esac
HEAP_MB=${HEAP_MB:-6144}
JAR_URL=https://piston-data.mojang.com/v1/objects/97ccd4c0ed3f81bbb7bfacddd1090b0c56f9bc51/server.jar
JAR_SHA1=97ccd4c0ed3f81bbb7bfacddd1090b0c56f9bc51
JAR=$DIR/data/local-server/server-26.1.2.jar

mkdir -p "$DIR/data/local-server" "$WORLD"
# Each local server has its own random RCON password (gitignored file, mode 600); the local-N
# server profile reads it. No default password: a known one was public for months.
PASS_FILE=$DIR/data/local-server/rcon-$N.pass
if [ ! -s "$PASS_FILE" ]; then
  (umask 077 && head -c 24 /dev/urandom | od -An -tx1 | tr -d " \\n" > "$PASS_FILE")
fi
if [ ! -f "$JAR" ] || [ "$(shasum -a 1 "$JAR" | cut -d' ' -f1)" != "$JAR_SHA1" ]; then
  curl -fsSL -o "$JAR.tmp" "$JAR_URL"
  [ "$(shasum -a 1 "$JAR.tmp" | cut -d' ' -f1)" = "$JAR_SHA1" ] || { echo "server.jar sha1 mismatch" >&2; exit 1; }
  mv "$JAR.tmp" "$JAR"
fi
JAVA=${JAVA:-$(nix build --no-link --print-out-paths nixpkgs#jdk25)/bin/java}

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
server-port=$PORT
server-ip=127.0.0.1
level-seed=typecraft
level-type=minecraft:normal
generate-structures=true
motd=steve gym local-$N (26.1.2)
white-list=false
spawn-monsters=true
spawn-animals=true
spawn-npcs=true
allow-flight=true
rate-limit=0
enable-rcon=true
rcon.password=$(cat "$PASS_FILE")
rcon.port=$RCON_PORT
broadcast-rcon-to-ops=true
# 26.x pauses an empty server after 60 s; forceloaded chunks then barely load (a 4-chunk
# patch took 153 s). Gyms and pregeneration run with no player for long stretches.
pause-when-empty-seconds=0
PROPS

# Op the gym names with their offline-mode UUIDs (RCON `op` before a first join records the
# lowercased name under a different UUID).
node -e '
const c = require("crypto");
const uuid = (n) => { const h = c.createHash("md5").update("OfflinePlayer:" + n).digest(); h[6] = (h[6] & 0x0f) | 0x30; h[8] = (h[8] & 0x3f) | 0x80; const x = h.toString("hex"); return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join("-"); };
const names = ["Gym_cast", "Gym_craft", "Gym_dragon", "Gym_water", "Gym_blaze", "Gym_smoke"];
console.log(JSON.stringify(names.map((name) => ({ uuid: uuid(name), name, level: 4, bypassesPlayerLimit: true })), null, 2));
' > ops.json

exec "$JAVA" -Xms1G -Xmx${HEAP_MB}M -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
  -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 \
  -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 \
  -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:SurvivorRatio=32 \
  -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 -jar "$JAR" nogui
