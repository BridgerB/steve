{
  description = "Steve - Minecraft Ender Dragon Speedrun Bot";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    treefmt-nix.url = "github:numtide/treefmt-nix";
    git-hooks-nix.url = "github:cachix/git-hooks.nix";
  };

  outputs =
    {
      self,
      nixpkgs,
      treefmt-nix,
      git-hooks-nix,
    }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

      # Dev tools only needed on x86_64 dev machine
      devSystem = "x86_64-linux";
      devPkgs = pkgsFor devSystem;

      version = "1.21.11";
      rconPassword = "minecraft-test-rcon";
      rconPort = "25575";

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

      # Build all packages for a given system
      makePackages =
        pkgs:
        let
          serverJar = pkgs.fetchurl {
            url = "https://piston-data.mojang.com/v1/objects/64bb6d763bed0a9f1d632ec347938594144943ed/server.jar";
            sha256 = "09hpvmjnspf74k8ks9imcc3lqz8p3gjald3y3j9nz035704qwfzq";
          };
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
          opsJson = pkgs.writeText "ops.json" (
            builtins.toJSON [
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
            ]
          );
        in
        rec {
          rcon = pkgs.writeShellScriptBin "rcon" ''
            ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "$@"
          '';

          startServer = pkgs.writeShellScriptBin "minecraft-server" ''
            set -euo pipefail

            # Load .env if it exists (for MC_MEMORY etc.)
            if [ -f .env ]; then set -a; source .env; set +a; fi

            # Create and enter server directory
            mkdir -p data/server
            cd data/server

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
            if [ ! -f ../typecraft/src/data/blocks.json ]; then
              echo "Running typecraft datagen..."
              (cd ../typecraft && ${pkgs.nodejs_25}/bin/npx tsx src/registry/datagen.ts 2>/dev/null || true)
            fi

            # Ensure steve node_modules exist (always use nix node so native modules match)
            if [ ! -d node_modules ] || ! ${pkgs.nodejs_25}/bin/node -e "require('better-sqlite3')" 2>/dev/null; then
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

            mkdir -p data/server

            # Generate world backup if it doesn't exist
            if [ ! -d data/world ]; then
              echo "No world backup found — generating one..."
              ${startServer}/bin/minecraft-server > data/server/server.log 2>&1 &
              GEN_PID=$!
              while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
              while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
              echo "World generated. Saving backup..."
              kill $GEN_PID 2>/dev/null; wait $GEN_PID 2>/dev/null || true
              sleep 2
              cp -r data/server/world data/world
              echo "Backup saved to data/world"
            fi

            # Reset world from backup
            rm -rf data/server/world
            cp -r data/world data/server/world

            # Load .env if it exists
            if [ -f .env ]; then
              set -a; source .env; set +a
            fi

            # Start server (logs to file, not terminal)
            ${startServer}/bin/minecraft-server > data/server/server.log 2>&1 &
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

          runBench = pkgs.writeShellScriptBin "run-bench" ''
            set -euo pipefail
            cd "$(pwd)"

            ${pkgs.procps}/bin/pkill -9 -f "server.jar nogui" 2>/dev/null || true
            ${pkgs.procps}/bin/pkill -9 -f "STEVE_BOT_MODE" 2>/dev/null || true
            sleep 2

            mkdir -p data/server

            # Generate world backup if missing
            if [ ! -d data/world ]; then
              echo "No world backup — generating..."
              ${startServer}/bin/minecraft-server > data/server/server.log 2>&1 &
              GEN_PID=$!
              while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
              while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
              kill $GEN_PID 2>/dev/null; wait $GEN_PID 2>/dev/null || true
              sleep 2
              cp -r data/server/world data/world
            fi

            rm -rf data/server/world
            cp -r data/world data/server/world

            if [ -f .env ]; then set -a; source .env; set +a; fi

            ${startServer}/bin/minecraft-server > data/server/server.log 2>&1 &
            SERVER_PID=$!
            trap "kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null" EXIT

            # Wait for RCON
            while ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; do sleep 1; done
            while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
            while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done

            exec ${pkgs.nodejs_25}/bin/node src/bench.ts "$@"
          '';

          runTests = pkgs.writeShellScriptBin "run-tests" ''
            set -euo pipefail

            export STEVE_DIR="$(pwd)"

            # Kill any lingering server and wait for ports to free
            ${pkgs.procps}/bin/pkill -9 -f "server.jar nogui" 2>/dev/null || true
            ${pkgs.procps}/bin/pkill -9 -f "STEVE_BOT_MODE" 2>/dev/null || true
            sleep 2

            # Reset world from backup
            rm -rf data/server/world
            cp -r data/world data/server/world

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

          runMcp = pkgs.writeShellScriptBin "run-mcp" ''
            set -euo pipefail
            cd "$(pwd)"

            # Ensure deps (all output to stderr — stdout is MCP transport)
            if [ ! -d ../typecraft ]; then
              echo "Cloning typecraft..." >&2
              ${pkgs.git}/bin/git clone https://github.com/BridgerB/typecraft.git ../typecraft
            fi
            if [ ! -d ../typecraft/node_modules ]; then
              (cd ../typecraft && ${pkgs.nodejs_25}/bin/npm install) >&2
            fi
            if [ ! -d node_modules ] || ! ${pkgs.nodejs_25}/bin/node -e "require('better-sqlite3')" 2>/dev/null; then
              ${pkgs.nodejs_25}/bin/npm install >&2
            fi

            exec ${pkgs.nodejs_25}/bin/node src/mcp.ts
          '';

          runRace = pkgs.writeShellScriptBin "run-race" ''
            set -euo pipefail
            cd "$(pwd)"

            # Ensure deps
            if [ ! -d ../typecraft/node_modules ]; then
              (cd ../typecraft && ${pkgs.nodejs_25}/bin/npm install)
            fi
            if [ ! -d node_modules ] || ! ${pkgs.nodejs_25}/bin/node -e "require('better-sqlite3')" 2>/dev/null; then
              ${pkgs.nodejs_25}/bin/npm install
            fi

            # Verify typecraft data is generated
            if [ ! -f ../typecraft/src/data/packets-raw.json ]; then
              echo "Error: typecraft data not generated."
              echo "Run: cd ~/Developer/typecraft && nix run .#datagen"
              exit 1
            fi

            # Verify server is running
            if ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; then
              echo "Error: MC server not running on localhost:25565"
              echo "Start it first: nix run .#server"
              exit 1
            fi

            if [ -f .env ]; then set -a; source .env; set +a; fi

            export MC_RCON_PORT="${rconPort}"
            export MC_RCON_PASS="${rconPassword}"

            # Open browser if available
            if command -v ${pkgs.chromium}/bin/chromium &>/dev/null && [ -n "''${DISPLAY:-}" ]; then
              (while ! ${pkgs.netcat}/bin/nc -z localhost 3000 2>/dev/null; do sleep 1; done
               sleep 2
               ${pkgs.chromium}/bin/chromium http://localhost:3000 2>/dev/null &) &
            fi

            exec ${pkgs.nodejs_25}/bin/node src/main.ts "$@"
          '';

          runReset = pkgs.writeShellScriptBin "run-reset" ''
            set -euo pipefail
            cd "$(pwd)"

            mkdir -p data/server

            # Generate world backup if missing
            if [ ! -d data/world ]; then
              echo "No world backup — generating..."
              ${startServer}/bin/minecraft-server > data/server/server.log 2>&1 &
              GEN_PID=$!
              while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
              while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
              kill $GEN_PID 2>/dev/null; wait $GEN_PID 2>/dev/null || true
              sleep 2
              cp -r data/server/world data/world
              echo "Backup saved to data/world"
            fi

            # Kill running server
            ${pkgs.procps}/bin/pkill -9 -f "server.jar nogui" 2>/dev/null || true
            sleep 2

            # Reset world
            rm -rf data/server/world
            cp -r data/world data/server/world
            echo "World reset."

            # Restart server
            ${startServer}/bin/minecraft-server > data/server/server.log 2>&1 &
            SERVER_PID=$!

            while ! ${pkgs.netcat}/bin/nc -z localhost 25565 2>/dev/null; do sleep 1; done
            while ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; do sleep 1; done
            while ! ${pkgs.mcrcon}/bin/mcrcon -H localhost -P ${rconPort} -p ${rconPassword} "list" 2>/dev/null | grep -q "players"; do sleep 1; done
            echo "Server ready. (PID $SERVER_PID)"
            wait $SERVER_PID
          '';
        };

      treefmtEval = treefmt-nix.lib.evalModule devPkgs {
        projectRootFile = "flake.nix";
        programs.biome.enable = true;
        programs.nixfmt.enable = true;
      };

      pre-commit-check = git-hooks-nix.lib.${devSystem}.run {
        src = ./.;
        hooks = {
          treefmt = {
            enable = true;
            package = treefmtEval.config.build.wrapper;
          };
          biome-lint = {
            enable = true;
            name = "biome lint";
            entry = "${devPkgs.nodejs_25}/bin/npx biome lint .";
            pass_filenames = false;
            language = "system";
          };
          tsc = {
            enable = true;
            name = "tsc";
            entry = "${devPkgs.nodejs_25}/bin/npx tsc --noEmit";
            pass_filenames = false;
            language = "system";
            types = [ "ts" ];
          };
        };
      };
    in
    {
      formatter.${devSystem} = treefmtEval.config.build.wrapper;

      checks.${devSystem} = {
        formatting = treefmtEval.config.build.check self;
        inherit pre-commit-check;
      };

      packages = forAllSystems (
        system:
        let
          p = makePackages (pkgsFor system);
        in
        {
          default = p.runRace;
          server = p.startServer;
          race = p.runRace;
          full = p.runSteve;
          bench = p.runBench;
          rcon = p.rcon;
          test = p.runTests;
          mcp = p.runMcp;
          reset = p.runReset;
        }
      );

      apps = forAllSystems (
        system:
        let
          p = makePackages (pkgsFor system);
        in
        {
          default = {
            type = "app";
            program = "${p.runRace}/bin/run-race";
          };
          server = {
            type = "app";
            program = "${p.startServer}/bin/minecraft-server";
          };
          race = {
            type = "app";
            program = "${p.runRace}/bin/run-race";
          };
          full = {
            type = "app";
            program = "${p.runSteve}/bin/run-steve";
          };
          bench = {
            type = "app";
            program = "${p.runBench}/bin/run-bench";
          };
          rcon = {
            type = "app";
            program = "${p.rcon}/bin/rcon";
          };
          mcp = {
            type = "app";
            program = "${p.runMcp}/bin/run-mcp";
          };
          reset = {
            type = "app";
            program = "${p.runReset}/bin/run-reset";
          };
          test = {
            type = "app";
            program = "${p.runTests}/bin/run-tests";
          };
        }
      );

      devShells.${devSystem}.default =
        let
          p = makePackages devPkgs;
        in
        devPkgs.mkShell {
          shellHook = pre-commit-check.shellHook + ''

            echo ""
            echo "  steve — minecraft speedrun bot"
            echo ""
            echo "  nix run .#server        start server (persistent)"
            echo "  nix run . -- 20 600     race bots (server must be running)"
            echo "  nix run .#full          full run (server + world reset + bots)"
            echo "  nix run .#reset         reset world + restart server"
            echo "  nix run .#test          run tests"
            echo "  nix run .#bench         benchmark a step"
            echo "  nix fmt                 format (biome + nixfmt)"
            echo "  npm run lint            biome lint"
            echo "  npm run check           tsc typecheck"
            echo "  rcon <cmd>              send rcon command"
            echo ""
          '';
          buildInputs = [
            p.startServer
            p.runSteve
            p.rcon
            devPkgs.jre
            devPkgs.nodejs_25
            devPkgs.mcrcon
            treefmtEval.config.build.wrapper
          ]
          ++ pre-commit-check.enabledPackages;
        };
    };
}
