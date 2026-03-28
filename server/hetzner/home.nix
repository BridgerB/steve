{ pkgs, ... }:
{
  home.stateVersion = "25.11";

  home.packages = with pkgs; [
    ripgrep
    fd
    jq
    gh
    tree
    zip
    unzip
    vim
    htop
    btop
    lazygit
    delta
    sqlite
  ];

  home.file."bin/start-server" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      cd ~/Developer/steve
      pkill -f 'server.jar nogui' 2>/dev/null && echo 'Stopped old MC server' && sleep 3 || true
      if [ -d data/world ]; then
        rm -rf data/server/world
        cp -r data/world data/server/world
        echo 'World reset from backup'
      fi
      exec env MC_MEMORY=8G nix run
    '';
  };

  home.file."bin/race-startup" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      cd ~/Developer/steve
      echo 'Waiting for MC server...'
      while ! nc -z localhost 25565 2>/dev/null; do sleep 1; done
      echo 'Server ready'
      rm -rf data/races/*
      echo 'Warmup race (1 bot, 60s)...'
      echo
      node src/main.ts 1 60
      echo
      exec bash --init-file ~/bin/race-init
    '';
  };

  home.file."bin/race-summary" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      cd ~/Developer/steve
      npm install --prefer-offline --silent 2>/dev/null
      exec node src/race-summary.ts
    '';
  };

  home.file."bin/race-init" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      source ~/.bashrc 2>/dev/null
      bind '"\e[0n": "node src/main.ts 10 600"'
      printf '\e[5n'
    '';
  };

  home.sessionVariables = {
    TERM = "xterm-256color";
  };

  home.shellAliases = {
    claude = "npx @anthropic-ai/claude-code@latest --dangerously-skip-permissions";
  };

  programs.bash.enable = true; # required for home.shellAliases to land in .bashrc

  programs.lazygit = {
    enable = true;
    settings = {
      git.pagers = [
        {
          colorArg = "always";
          pager = "delta --dark --side-by-side --paging=never --line-numbers";
        }
      ];
    };
  };

  programs.zellij = {
    enable = true;
    enableBashIntegration = true;
    layouts = {
      steve = ''
        layout {
          default_tab_template {
            pane size=1 borderless=true {
              plugin location="zellij:tab-bar"
            }
            children
            pane size=2 borderless=true {
              plugin location="zellij:status-bar"
            }
          }
          tab name="system" {
            pane command="btop"
          }
          tab name="server" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "-lc" "~/bin/start-server"
            }
          }
          tab name="rcon" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "-c" "echo 'Waiting for RCON...' && until nc -z localhost 25575 2>/dev/null; do sleep 2; done && nix run .#rcon"
            }
          }
          tab name="steve" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "-lc" "lazygit"
            }
          }
          tab name="typecraft" cwd="/home/bridger/Developer/typecraft" {
            pane command="bash" {
              args "-lc" "lazygit"
            }
          }
          tab name="journal" {
            pane command="bash" {
              args "-lc" "systemctl --user status claude-remote-control --no-pager 2>/dev/null; echo; echo '── Waiting for errors ──'; journalctl --user -f -u claude-remote-control | grep -iE \"error|fail|Started|Stopped|exited|restart\""
            }
          }
          tab name="race" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "--init-file" "/home/bridger/bin/race-init"
            }
          }
          tab name="results" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "-lc" "while true; do out=$(~/bin/race-summary 2>&1); printf '\\033[H\\033[J%s\\n' \"$out\"; sleep 2; done"
            }
          }
          tab name="claude" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "-lc" "npx @anthropic-ai/claude-code@latest --dangerously-skip-permissions"
            }
          }
          tab name="shell" cwd="/home/bridger/Developer/steve" {
            pane
          }
        }
      '';
    };
  };

  systemd.user.services.claude-remote-control = {
    Unit = {
      Description = "Claude Code Remote Control";
      After = [ "network-online.target" ];
    };
    Service = {
      Type = "simple";
      WorkingDirectory = "/home/bridger/Developer/steve";
      ExecStart = "${pkgs.nodePackages.npm}/bin/npx @anthropic-ai/claude-code@latest remote-control";
      Restart = "on-failure";
      RestartSec = 10;
      Environment = [
        "HOME=/home/bridger"
        "TERM=xterm-256color"
        "PATH=/run/current-system/sw/bin:/etc/profiles/per-user/bridger/bin:/home/bridger/.nix-profile/bin"
      ];
    };
    Install = {
      WantedBy = [ "default.target" ];
    };
  };
}
