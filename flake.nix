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
      "-Xmx4G"
      "-Xms4G"
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
      max-players=10
      online-mode=false
      pvp=false
      difficulty=normal
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

      exec ${pkgs.jre}/bin/java ${jvmOpts} -jar ${serverJar} nogui
    '';

    # Wait for server to be ready, then run Steve
    runSteve = pkgs.writeShellScriptBin "run-steve" ''
      set -euo pipefail

      STEVE_DIR="''${STEVE_DIR:-$(pwd)}"
      export NODE_PATH="$STEVE_DIR/node_modules"

      echo "Waiting for Minecraft server on localhost:25565..."
      while ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; do
        sleep 1
      done
      echo "Game port up! Waiting for RCON on localhost:${rconPort}..."
      while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do
        sleep 1
      done
      echo "RCON is up! Waiting for server to finish loading..."

      # Wait until RCON actually responds (world gen can take a while on first run)
      while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do
        sleep 2
      done
      echo "Server is ready!"

      echo "Server ready. Running at normal speed (1x)."

      echo "Starting Steve bot..."
      exec ${pkgs.nodejs}/bin/npx tsx "$STEVE_DIR/src/main.ts"
    '';

    # Start server + Steve together
    runAll = pkgs.writeShellScriptBin "run-all" ''
      set -euo pipefail

      export STEVE_DIR="$(pwd)"

      # Reset world from backup
      rm -rf server/world
      cp -r data/world server/world

      echo "=== Starting server + Steve ==="

      # Start server in background
      ${startServer}/bin/minecraft-server &
      SERVER_PID=$!

      # Cleanup on exit
      trap "kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null" EXIT

      # Wait for server then run Steve
      ${runSteve}/bin/run-steve
    '';

    # Test runner
    runTests = pkgs.writeShellScriptBin "run-tests" ''
      set -euo pipefail

      # Check if server is running
      if ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; then
        echo "Error: Minecraft server not running. Start it first with: nix run"
        exit 1
      fi

      echo "Running tests..."
      cd "$(pwd)"
      ${pkgs.nodejs}/bin/node --import tsx --test "src/**/*.test.ts" "$@"
    '';
  in {
    packages.${system} = {
      default = runAll;
      server = startServer;
      steve = runSteve;
      all = runAll;
      rcon = rcon;
      test = runTests;
    };

    apps.${system} = {
      default = {
        type = "app";
        program = "${runAll}/bin/run-all";
      };
      steve = {
        type = "app";
        program = "${runSteve}/bin/run-steve";
      };
      all = {
        type = "app";
        program = "${runAll}/bin/run-all";
      };
      test = {
        type = "app";
        program = "${runTests}/bin/run-tests";
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
        runAll
        rcon
        pkgs.jre
        pkgs.nodejs
        pkgs.mcrcon
      ];
      shellHook = ''
        echo "Steve - Minecraft Bot"
        echo ""
        echo "  nix run            Start MC server only"
        echo "  nix run .#steve    Start Steve (server must be running)"
        echo "  nix run .#all      Start server + Steve together"
        echo "  nix run .#test     Run tests (server must be running)"
        echo "  rcon <cmd>         Send RCON command"
        echo ""
      '';
    };
  };
}
