{
  description = "Steve - Minecraft Ender Dragon Speedrun Bot";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
      config.allowUnfree = true;
    };

    version = "1.21.11";
    rconPassword = "minecraft-test-rcon";
    rconPort = "25575";

    serverJar = pkgs.fetchurl {
      url = "https://piston-data.mojang.com/v1/objects/64bb6d763bed0a9f1d632ec347938594144943ed/server.jar";
      sha256 = "09hpvmjnspf74k8ks9imcc3lqz8p3gjald3y3j9nz035704qwfzq";
    };

    jvmOpts = builtins.concatStringsSep " " [
      "-XX:+UseG1GC"
      "-XX:+ParallelRefProcEnabled"
      "-XX:MaxGCPauseMillis=200"
      "-XX:+UnlockExperimentalVMOptions"
      "-XX:+DisableExplicitGC"
      "-XX:G1NewSizePercent=30"
      "-XX:G1MaxNewSizePercent=40"
      "-XX:G1HeapRegionSize=8M"
      "-XX:G1ReservePercent=20"
      "-XX:G1HeapWastePercent=5"
      "-XX:G1MixedGCCountTarget=4"
      "-XX:InitiatingHeapOccupancyPercent=15"
      "-XX:G1MixedGCLiveThresholdPercent=90"
      "-XX:SurvivorRatio=32"
      "-XX:+PerfDisableSharedMem"
      "-XX:MaxTenuringThreshold=1"
    ];

    # Optimized for single-bot testing: minimal view distance, fast ticks
    serverProperties = pkgs.writeText "server.properties" ''
      max-players=100
      online-mode=false
      pvp=false
      difficulty=peaceful
      gamemode=survival
      enable-command-block=true
      spawn-protection=0
      view-distance=10
      simulation-distance=6
      server-port=25565
      level-seed=1
      motd=Steve Bot Testing Server
      white-list=false
      spawn-monsters=true
      spawn-animals=true
      spawn-npcs=true
      allow-flight=false
      rate-limit=0
      enable-rcon=true
      rcon.password=${rconPassword}
      rcon.port=${rconPort}
      broadcast-rcon-to-ops=true
    '';

    opsJson = pkgs.writeText "ops.json" (builtins.toJSON [
      {
        uuid = "8cf67a27-46d2-366b-b426-26e174de7007";
        name = "Bird47";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "5627dd98-e6be-3c21-b8a8-e92344183641";
        name = "Steve";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "62ff0b01-b491-3228-9dff-e7512ac3df09";
        name = "TestWood";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "cfabfddb-9454-3464-89f6-4b9739b31378";
        name = "TestMine";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "bc62a0e8-28ba-3990-bb75-3243edbaaaae";
        name = "TestCraft";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "6cb83f7d-6083-337e-9f3b-fc432b78c868";
        name = "TestSmelt";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "6d9e2f2c-1a69-3188-a71c-1b083e2c913a";
        name = "TestCombat";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "8158f5a2-defc-329c-85bf-e0bf4cd705fd";
        name = "TestFood";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "90e75911-9640-3547-ab02-f3bf7935d34b";
        name = "TestNether";
        level = 4;
        bypassesPlayerLimit = true;
      }
      {
        uuid = "c24246ee-47cc-3053-bbec-cf068c18fa59";
        name = "TestEnd";
        level = 4;
        bypassesPlayerLimit = true;
      }
    ]);

    # RCON client script
    rcon = pkgs.writeShellScriptBin "rcon" ''
      ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "$@"
    '';

    startServer = pkgs.writeShellScriptBin "minecraft-server" ''
      set -euo pipefail

      # Create and enter server directory
      mkdir -p server
      cd server

      # Setup eula
      echo "eula=true" > eula.txt

      # Copy server.properties and ops.json
      cp -f ${serverProperties} server.properties
      cp -f ${opsJson} ops.json
      chmod +w server.properties ops.json

      echo "Starting Minecraft Server ${version}..."
      echo "Server will be available at: localhost:25565"
      echo "RCON available at: localhost:${rconPort}"
      echo ""

      MEM=''${MC_MEMORY:-4G}
      exec ${pkgs.jre}/bin/java -Xmx$MEM -Xms$MEM ${jvmOpts} -jar ${serverJar} nogui
    '';

    # Start server + run Steve bots
    # Usage: nix run             (1 bot, 300s timeout)
    #        nix run -- 5 180    (5 bots, 180s timeout)
    runSteve = pkgs.writeShellScriptBin "run-steve" ''
      set -euo pipefail
      cd "$(pwd)"

      # Ensure typecraft is cloned + has deps + datagen
      if [ ! -d ../typecraft ]; then
        echo "Cloning typecraft..."
        ${pkgs.git}/bin/git clone https://github.com/BridgerB/typecraft.git ../typecraft
      fi
      if [ ! -d ../typecraft/node_modules ]; then
        echo "Installing typecraft dependencies..."
        (cd ../typecraft && ${pkgs.nodejs_25}/bin/npm install)
      fi
      if [ ! -d ../typecraft/src/data/blocks-raw ]; then
        echo "Running typecraft datagen..."
        (cd ../typecraft && ${pkgs.nodejs_25}/bin/npx tsx src/registry/datagen.ts 2>/dev/null || true)
      fi

      # Ensure steve node_modules exist
      if [ ! -d node_modules ]; then
        echo "Installing steve dependencies..."
        ${pkgs.nodejs_25}/bin/npm install
      fi

      # Kill any lingering processes and free ports
      ${pkgs.procps}/bin/pkill -9 -f "server.jar nogui" 2>/dev/null || true
      ${pkgs.procps}/bin/pkill -9 -f "STEVE_BOT_MODE" 2>/dev/null || true
      for port in 3000 25565 25575; do
        ${pkgs.util-linux}/bin/fuser -k $port/tcp 2>/dev/null || true
      done
      sleep 2

      mkdir -p data server

      # Generate world backup if it doesn't exist
      if [ ! -d data/world ]; then
        echo "No world backup found — generating one..."
        ${startServer}/bin/minecraft-server > server/server.log 2>&1 &
        GEN_PID=$!
        while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
        while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
        echo "World generated. Saving backup..."
        kill $GEN_PID 2>/dev/null; wait $GEN_PID 2>/dev/null || true
        sleep 2
        cp -r server/world data/world
        echo "Backup saved to data/world"
      fi

      # Reset world from backup
      rm -rf server/world
      cp -r data/world server/world

      # Load .env if it exists
      if [ -f .env ]; then
        set -a; source .env; set +a
      fi

      # Start server (logs to file, not terminal)
      ${startServer}/bin/minecraft-server > server/server.log 2>&1 &
      SERVER_PID=$!
      trap "kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null" EXIT

      # Wait for RCON
      while ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; do sleep 1; done
      while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
      while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done

      export MC_RCON_PORT="${rconPort}"
      export MC_RCON_PASS="${rconPassword}"

      # Open browser if available (skip on headless servers)
      if command -v ${pkgs.chromium}/bin/chromium &>/dev/null && [ -n "''${DISPLAY:-}" ]; then
        (while ! ${pkgs.netcat}/bin/nc -z localhost 3000 2>/dev/null; do sleep 1; done
         sleep 2
         ${pkgs.chromium}/bin/chromium http://localhost:3000 2>/dev/null &) &
      fi

      exec ${pkgs.nodejs_25}/bin/node src/main.ts "$@"
    '';

    # Bench runner — starts server, runs step benchmark
    # Usage: nix run .#bench -- mine_stone 10 120
    runBench = pkgs.writeShellScriptBin "run-bench" ''
      set -euo pipefail
      cd "$(pwd)"

      ${pkgs.procps}/bin/pkill -9 -f "server.jar nogui" 2>/dev/null || true
      ${pkgs.procps}/bin/pkill -9 -f "STEVE_BOT_MODE" 2>/dev/null || true
      sleep 2

      mkdir -p data server

      # Generate world backup if missing
      if [ ! -d data/world ]; then
        echo "No world backup — generating..."
        ${startServer}/bin/minecraft-server > server/server.log 2>&1 &
        GEN_PID=$!
        while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
        while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
        kill $GEN_PID 2>/dev/null; wait $GEN_PID 2>/dev/null || true
        sleep 2
        cp -r server/world data/world
      fi

      rm -rf server/world
      cp -r data/world server/world

      if [ -f .env ]; then set -a; source .env; set +a; fi

      ${startServer}/bin/minecraft-server > server/server.log 2>&1 &
      SERVER_PID=$!
      trap "kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null" EXIT

      # Wait for RCON
      while ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; do sleep 1; done
      while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
      while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done

      exec ${pkgs.nodejs_25}/bin/node src/bench.ts "$@"
    '';

    # Test runner — starts server, runs tests, shuts down
    runTests = pkgs.writeShellScriptBin "run-tests" ''
      set -euo pipefail

      export STEVE_DIR="$(pwd)"

      # Kill any lingering server and wait for ports to free
      ${pkgs.procps}/bin/pkill -9 -f "server.jar nogui" 2>/dev/null || true
      ${pkgs.procps}/bin/pkill -9 -f "STEVE_BOT_MODE" 2>/dev/null || true
      sleep 2

      # Reset world from backup
      rm -rf server/world
      cp -r data/world server/world

      # Start server in background
      ${startServer}/bin/minecraft-server &
      SERVER_PID=$!
      trap "kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null" EXIT

      # Wait for server
      echo "Waiting for server..."
      while ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; do sleep 1; done
      while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
      while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
      echo "Server ready."

      echo "Running tests..."
      if [ -n "''${1:-}" ]; then
        echo "Filter: $1"
        ${pkgs.nodejs_25}/bin/node --test --test-name-pattern "$1" src/test.ts
      else
        ${pkgs.nodejs_25}/bin/node --test src/test.ts
      fi
    '';
  in {
    packages.${system} = {
      default = runSteve;
      server = startServer;
      steve = runSteve;
      bench = runBench;
      rcon = rcon;
      test = runTests;
    };

    apps.${system} = {
      default = {
        type = "app";
        program = "${runSteve}/bin/run-steve";
      };
      steve = {
        type = "app";
        program = "${runSteve}/bin/run-steve";
      };
      test = {
        type = "app";
        program = "${runTests}/bin/run-tests";
      };
      bench = {
        type = "app";
        program = "${runBench}/bin/run-bench";
      };
      rcon = {
        type = "app";
        program = "${rcon}/bin/rcon";
      };
    };

    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [
        startServer
        runSteve
        rcon
        pkgs.jre
        pkgs.nodejs_25
        pkgs.mcrcon
      ];
      shellHook = ''
        echo "Steve - Minecraft Bot"
        echo ""
        echo "  nix run              1 bot (default)"
        echo "  nix run -- 5 180     5 bots, 3min timeout"
        echo "  nix run .#test       Run tests"
        echo "  nix run .#server     Server only"
        echo "  rcon <cmd>           Send RCON command"
        echo ""
      '';
    };
  };
}
