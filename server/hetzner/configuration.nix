{ pkgs, ... }:
{
  imports = [
    ./hetzner.nix
  ];

  system.stateVersion = "25.11";

  networking.hostName = "steve";

  # SSH
  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = false;
      PermitRootLogin = "no";
    };
  };

  # Docker
  virtualisation.docker.enable = true;

  # User
  users.users.bridger = {
    isNormalUser = true;
    extraGroups = [
      "wheel"
      "docker"
    ];
    openssh.authorizedKeys.keys = [
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID5mdblREEnjNE8hqgViMurQOrDMPVeW46u9Jbw1oqwB bridger@nixos"
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM2/0RiMdk6keMhpqmui0J0USiRQ8Mqy7meOOEPAgVHx bridger@bridgers-MacBook-Pro.local"
    ];
  };

  security.sudo.wheelNeedsPassword = false;

  # Nix
  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];
  nix.settings.trusted-users = [
    "root"
    "bridger"
  ];
  nix.nixPath = [ ];

  # Firewall
  networking.firewall.allowedTCPPorts = [ 22 ];

  # Packages
  environment.systemPackages = with pkgs; [
    nodejs_25
    python3
    gnumake
    curl
    git
    jdk21
  ];

  # Home Manager
  home-manager.useGlobalPkgs = true;
  home-manager.useUserPackages = true;
  home-manager.backupFileExtension = "bak";
  home-manager.users.bridger = import ./home.nix;
}
