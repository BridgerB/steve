{
  description = "NixOS Minecraft server on Hetzner Cloud";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      nixpkgs,
      disko,
      home-manager,
      ...
    }:
    let
      pkgs = import nixpkgs { system = "x86_64-linux"; };
      ip = "204.168.215.50";

      deploy = pkgs.writeShellScript "deploy" ''
        echo "Deploying to ${ip}"
        echo "  1) Fresh install (nixos-anywhere — wipes disk)"
        echo "  2) Apply config changes (nixos-rebuild switch)"
        echo ""
        printf "Choice: "
        read -r choice

        if [ "$choice" = "1" ]; then
          ssh-keygen -R ${ip} || true
          nix run github:nix-community/nixos-anywhere -- --flake .#default root@${ip}
        elif [ "$choice" = "2" ]; then
          nix run nixpkgs#nixos-rebuild -- switch \
            --flake .#default \
            --target-host bridger@${ip} \
            --build-host bridger@${ip} \
            --use-remote-sudo
        else
          echo "Invalid choice"
          exit 1
        fi
      '';
    in
    {
      nixosConfigurations.default = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          disko.nixosModules.disko
          home-manager.nixosModules.home-manager
          ./configuration.nix
        ];
      };

      apps.x86_64-linux.deploy = {
        type = "app";
        program = "${deploy}";
      };
    };
}
