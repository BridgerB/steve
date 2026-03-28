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
            level-seed=typecraft
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
          startServer = pkgs.writeShellScriptBin "minecraft-server" ''
            set -euo pipefail

            # Load .env if it exists (for MC_MEMORY etc.)
            if [ -f .env ]; then set -a; source .env; set +a; fi

            # Kill any running server
            ${pkgs.procps}/bin/pkill -f 'server.jar nogui' 2>/dev/null && echo 'Stopped old MC server' && sleep 3 || true

            # Create and enter server directory
            mkdir -p data/server
            cd data/server

            # Fresh world every time
            rm -rf world

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

            exec ${pkgs.jre}/bin/java -Xmx18G -Xms1G ${jvmOpts} -jar ${serverJar} nogui
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
              sleep 3
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
          default = p.startServer;
          server = p.startServer;
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
            program = "${p.startServer}/bin/minecraft-server";
          };
          reset = {
            type = "app";
            program = "${p.runReset}/bin/run-reset";
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
            echo "  nix run                 start MC server"
            echo "  nix run .#reset         reset world + restart server"
            echo "  node src/rcon-cli.ts    interactive RCON console"
            echo "  node src/main.ts N T    race N bots for T seconds"
            echo "  node --test src/test.ts run tests"
            echo "  nix fmt                 format (biome + nixfmt)"
            echo ""
          '';
          buildInputs = [
            p.startServer
            devPkgs.jre
            devPkgs.nodejs_25
            treefmtEval.config.build.wrapper
          ]
          ++ pre-commit-check.enabledPackages;
        };
    };
}
