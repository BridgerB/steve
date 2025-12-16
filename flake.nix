{
  description = "Local Minecraft Server for Bot Testing";

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

    version = "1.21.8";
    rconPassword = "minecraft-test-rcon";
    rconPort = "25575";

    serverJar = pkgs.fetchurl {
      url = "https://piston-data.mojang.com/v1/objects/6bce4ef400e4efaa63a13d5e6f6b500be969ef81/server.jar";
      sha256 = "1rxvgyz969yhc1a0fnwmwwap1c548vpr0a39wx02rgnly2ldjj93";
    };

    jvmOpts = builtins.concatStringsSep " " [
      "-Xmx16G"
      "-Xms16G"
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

    serverProperties = pkgs.writeText "server.properties" ''
      max-players=1000
      online-mode=false
      pvp=true
      difficulty=normal
      gamemode=survival
      enable-command-block=true
      spawn-protection=0
      view-distance=10
      server-port=25565
      motd=Local Bot Testing Server
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
        name = "TestWorld";
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
      echo "Max players: 1000 | Online mode: OFF"
      echo ""

      exec ${pkgs.jre}/bin/java ${jvmOpts} -jar ${serverJar} nogui
    '';

    # Test runner - assumes server is already running
    runTests = pkgs.writeShellScriptBin "run-tests" ''
      set -euo pipefail

      # Check if server is running
      if ! ${pkgs.netcat}/bin/nc -z localhost ${rconPort} 2>/dev/null; then
        echo "Error: Minecraft server not running. Start it first with: nix run"
        exit 1
      fi

      echo "Running tests..."
      ${pkgs.deno}/bin/deno test -A --parallel "$@"
    '';
  in {
    packages.${system} = {
      default = startServer;
      server = startServer;
      rcon = rcon;
      test = runTests;
    };

    apps.${system} = {
      default = {
        type = "app";
        program = "${startServer}/bin/minecraft-server";
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
      buildInputs = [startServer rcon pkgs.jre pkgs.deno pkgs.mcrcon];
      shellHook = ''
        echo "Minecraft Server ${version} available"
        echo "Run: minecraft-server"
        echo "RCON: rcon <command>  (e.g., rcon 'op Bird47')"
        echo "Test: nix run .#test"
      '';
    };
  };
}
