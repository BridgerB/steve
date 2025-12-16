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

    # Minecraft server package with latest JAR
    minecraft-server = pkgs.stdenv.mkDerivation rec {
      pname = "minecraft-server";
      version = "1.21.8";

      src = pkgs.fetchurl {
        url = "https://piston-data.mojang.com/v1/objects/6bce4ef400e4efaa63a13d5e6f6b500be969ef81/server.jar";
        sha256 = "1rxvgyz969yhc1a0fnwmwwap1c548vpr0a39wx02rgnly2ldjj93";
      };

      preferLocalBuild = true;
      allowSubstitutes = false;
      dontUnpack = true;

      installPhase = ''
                  runHook preInstall

                  mkdir -p $out/bin $out/lib/minecraft
                  cp $src $out/lib/minecraft/server.jar

                  # Create launcher script that runs in ./server subdirectory
                  cat > $out/bin/minecraft-server << 'WRAPPER'
        #!/usr/bin/env bash
        set -euo pipefail

        # Create and enter server directory
        mkdir -p server
        cd server

        if [ ! -f eula.txt ]; then echo "eula=true" > eula.txt; echo "✅ Accepted EULA"; fi

        if [ -d world ] || [ -f server.properties ]; then
          echo ""
          echo "════════════════════════════════════════════════════════"
          echo "  Existing Minecraft server data found"
          echo "════════════════════════════════════════════════════════"
          echo ""
          echo "  [c] Continue with existing world and settings (default)"
          echo "  [u] Update server.properties to flake settings (keep world)"
          echo "  [f] Fresh start - delete everything and start over"
          echo "  [q] Quit without starting"
          echo ""
          read -p "Your choice [c/u/f/q]: " user_choice
          case "$user_choice" in
            u|U)
              echo ""
              echo "📝 Updating server.properties to match flake..."
              cat > server.properties <<PROPS
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
        PROPS
              echo "✅ Updated server.properties (world preserved)"
              echo ""
              ;;
            f|F)
              echo ""
              echo "🗑️  Deleting world data, logs, and server.properties..."
              rm -rf world/ logs/ server.properties usercache.json banned-*.json ops.json whitelist.json
              echo "✅ Cleaned up - starting fresh"
              echo ""
              cat > server.properties <<PROPS
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
        PROPS
              ;;
            q|Q)
              echo ""
              echo "👋 Exiting without starting server"
              exit 0
              ;;
            *)
              echo ""
              echo "✅ Continuing with existing data"
              echo ""
              ;;
          esac
        else
          cat > server.properties <<PROPS
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
        PROPS
          echo "✅ First run - generated server.properties"
          echo ""
        fi

        echo "🚀 Starting Minecraft Server 1.21.8..."
        echo "📍 Server will be available at: localhost:25565"
        echo "⚙️  Max players: 1000 | Online mode: OFF"
        echo ""

        export LD_LIBRARY_PATH="@udevLib@:''${LD_LIBRARY_PATH:-}"

        exec @java@ \
          -Xmx16G \
          -Xms16G \
          -XX:+UseG1GC \
          -XX:+ParallelRefProcEnabled \
          -XX:MaxGCPauseMillis=200 \
          -XX:+UnlockExperimentalVMOptions \
          -XX:+DisableExplicitGC \
          -XX:G1NewSizePercent=30 \
          -XX:G1MaxNewSizePercent=40 \
          -XX:G1HeapRegionSize=8M \
          -XX:G1ReservePercent=20 \
          -XX:G1HeapWastePercent=5 \
          -XX:G1MixedGCCountTarget=4 \
          -XX:InitiatingHeapOccupancyPercent=15 \
          -XX:G1MixedGCLiveThresholdPercent=90 \
          -XX:SurvivorRatio=32 \
          -XX:+PerfDisableSharedMem \
          -XX:MaxTenuringThreshold=1 \
          -jar @serverJar@ \
          nogui
        WRAPPER

                  substituteInPlace $out/bin/minecraft-server \
                    --replace-fail '@java@' '${pkgs.jre}/bin/java' \
                    --replace-fail '@serverJar@' "$out/lib/minecraft/server.jar" \
                    --replace-fail '@udevLib@' '${pkgs.systemd}/lib'

                  chmod +x $out/bin/minecraft-server

                  runHook postInstall
      '';

      meta = with pkgs.lib; {
        description = "Minecraft Server 1.21.8 (Local)";
        homepage = "https://minecraft.net";
        sourceProvidence = with sourceTypes; [binaryBytecode];
        license = licenses.unfreeRedistributable;
        platforms = platforms.unix;
      };
    };
  in {
    packages.${system}.default = minecraft-server;

    apps.${system}.default = {
      type = "app";
      program = "${minecraft-server}/bin/minecraft-server";
    };

    # Allow running with: nix develop
    devShells.${system}.default = pkgs.mkShell {
      buildInputs = [minecraft-server];
      shellHook = ''
        echo "Minecraft Server available in PATH"
        echo "Run: minecraft-server"
      '';
    };
  };
}
