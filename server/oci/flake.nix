{
  description = "NixOS Minecraft server on OCI ARM";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      nixpkgs,
      home-manager,
      ...
    }:
    let
      pkgs = import nixpkgs { system = "x86_64-linux"; };

      deploy = pkgs.writeShellScript "deploy" ''
        printf "OCI server IP: "
        read -r ip

        echo ""
        echo "  1) Initial deploy (SSH as root — first time only)"
        echo "  2) Apply config changes (SSH as bridger)"
        echo ""
        printf "Choice: "
        read -r choice

        if [ "$choice" = "1" ]; then
          ssh-keygen -R "$ip" || true

          echo "Generating hardware config..."
          ssh -o StrictHostKeyChecking=no "root@$ip" "nixos-generate-config"

          echo "Copying config files..."
          scp -o StrictHostKeyChecking=no \
            ${./flake.nix} "root@$ip:/etc/nixos/flake.nix"
          scp -o StrictHostKeyChecking=no \
            ${./flake.lock} "root@$ip:/etc/nixos/flake.lock"
          scp -o StrictHostKeyChecking=no \
            ${./configuration.nix} "root@$ip:/etc/nixos/configuration.nix"
          scp -o StrictHostKeyChecking=no \
            ${./home.nix} "root@$ip:/etc/nixos/home.nix"

          echo "Running nixos-rebuild..."
          ssh -o StrictHostKeyChecking=no "root@$ip" \
            "cd /etc/nixos && nixos-rebuild switch --flake .#default"

          echo ""
          echo "Done! SSH as bridger: ssh bridger@$ip"

        elif [ "$choice" = "2" ]; then
          nix run nixpkgs#nixos-rebuild -- switch \
            --flake .#default \
            --target-host "bridger@$ip" \
            --build-host "bridger@$ip" \
            --use-remote-sudo
        else
          echo "Invalid choice"
          exit 1
        fi
      '';
    in
    {
      nixosConfigurations.default = nixpkgs.lib.nixosSystem {
        system = "aarch64-linux";
        modules = [
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
