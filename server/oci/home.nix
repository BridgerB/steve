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
    neovim
    htop
    lazygit
    delta
    sqlite
  ];

  # ── Helper scripts ──

  home.file."bin/race-summary" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      cd ~/Developer/steve
      npm install --prefer-offline --silent 2>/dev/null
      exec node src/race-summary.ts
    '';
  };

  home.file."bin/rc-ctl" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      while true; do
        clear
        status=$(systemctl --user is-active claude-remote-control 2>/dev/null)
        if [ "$status" = "active" ]; then
          echo -e "  Remote Control: \e[32m● running\e[0m"
        else
          echo -e "  Remote Control: \e[31m● stopped\e[0m"
        fi
        echo
        echo "  1) start    2) stop    3) restart    4) status    q) quit"
        echo
        read -rsn1 key
        case $key in
          1) systemctl --user start claude-remote-control ;;
          2) systemctl --user stop claude-remote-control ;;
          3) systemctl --user restart claude-remote-control ;;
          4) systemctl --user status claude-remote-control --no-pager; read -rsn1 -p "press any key..." ;;
          q) break ;;
        esac
      done
    '';
  };

  home.file."bin/mc-ctl" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      while true; do
        clear
        status=$(systemctl --user is-active minecraft-server 2>/dev/null)
        if [ "$status" = "active" ]; then
          echo -e "  MC Server: \e[32m● running\e[0m"
        else
          echo -e "  MC Server: \e[31m● stopped\e[0m"
        fi
        echo
        echo "  1) start    2) stop    3) restart    4) status    q) quit"
        echo
        read -rsn1 key
        case $key in
          1) systemctl --user start minecraft-server ;;
          2) systemctl --user stop minecraft-server ;;
          3) systemctl --user restart minecraft-server ;;
          4) systemctl --user status minecraft-server --no-pager; read -rsn1 -p "press any key..." ;;
          q) break ;;
        esac
      done
    '';
  };

  home.file."bin/race-init" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      source ~/.bashrc 2>/dev/null
      bind '"\e[0n": "node src/main.ts --bots 10 --timeout 600"'
      printf '\e[5n'
    '';
  };

  # ── Environment ──

  home.sessionVariables = {
    TERM = "xterm-256color";
  };

  home.shellAliases = {
    claude = "npx @anthropic-ai/claude-code@latest --dangerously-skip-permissions";
    mc-start = "systemctl --user start minecraft-server";
    mc-stop = "systemctl --user stop minecraft-server";
    mc-restart = "systemctl --user restart minecraft-server";
    mc-status = "systemctl --user status minecraft-server";
    mc-log = "journalctl --user -f -u minecraft-server";
    rc-start = "systemctl --user start claude-remote-control";
    rc-stop = "systemctl --user stop claude-remote-control";
    rc-restart = "systemctl --user restart claude-remote-control";
    rc-status = "systemctl --user status claude-remote-control";
    rc-log = "journalctl --user -f -u claude-remote-control";
  };

  home.file.".claude/settings.json".text = builtins.toJSON {
    permissions = {
      defaultMode = "bypassPermissions";
      allow = [
        "Bash(*)"
        "Read"
        "Write"
        "Edit"
        "Grep"
        "Glob"
        "WebFetch"
        "WebSearch"
        "Agent"
        "mcp__steve__*"
      ];
    };
  };

  # ── Programs ──

  programs.btop = {
    enable = true;
    settings = {
      proc_sorting = "memory";
      proc_tree = true;
    };
  };

  programs.bash = {
    enable = true;
    initExtra = ''
      if [[ -z "$ZELLIJ" ]]; then
        active=$(zellij list-sessions 2>/dev/null | grep -v EXITED | sed 's/\x1B\[[0-9;]*m//g' | awk 'NR==1{print $1}')
        if [[ -n "$active" ]]; then
          exec zellij attach "$active"
        else
          zellij kill-all-sessions -y 2>/dev/null
          exec zellij -l steve
        fi
      fi
    '';
  };

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

  # ── Zellij layout ──

  programs.zellij = {
    enable = true;
    enableBashIntegration = false;
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
          tab name="steve" cwd="/home/bridger/Developer/steve" {
            pane stacked=true {
              pane expanded=true command="bash" {
                args "-lc" "lazygit"
              }
              pane command="bash" {
                args "-lc" "nvim ."
              }
            }
          }
          tab name="typecraft" cwd="/home/bridger/Developer/typecraft" {
            pane stacked=true {
              pane expanded=true command="bash" {
                args "-lc" "lazygit"
              }
              pane command="bash" {
                args "-lc" "nvim ."
              }
            }
          }
          tab name="shell" cwd="/home/bridger/Developer/steve" {
            pane
          }
          tab name="mc-server" cwd="/home/bridger/Developer/steve" {
            pane size="70%" command="bash" {
              args "-lc" "journalctl --user -f -u minecraft-server"
            }
            pane size="30%" command="bash" {
              args "-lc" "~/bin/mc-ctl"
            }
          }
          tab name="rcon" cwd="/home/bridger/Developer/steve" {
            pane command="bash" {
              args "-lc" "node src/rcon-cli.ts; exec bash -l"
            }
          }
          tab name="rc-log" {
            pane size="70%" command="bash" {
              args "-lc" "journalctl --user -f -u claude-remote-control"
            }
            pane size="30%" command="bash" {
              args "-lc" "~/bin/rc-ctl"
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
          tab name="system" {
            pane command="btop"
          }
        }
      '';
    };
  };

  # ── Systemd services ──

  systemd.user.services.minecraft-server = {
    Unit = {
      Description = "Minecraft Server";
      After = [ "network-online.target" ];
    };
    Service = {
      Type = "simple";
      WorkingDirectory = "/home/bridger/Developer/steve";
      ExecStart = "${pkgs.bash}/bin/bash -lc 'cd /home/bridger/Developer/steve && MC_MEMORY=8G nix run'";
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

  systemd.user.services.claude-remote-control = {
    Unit = {
      Description = "Claude Code Remote Control";
      After = [ "network-online.target" ];
    };
    Service = {
      Type = "simple";
      WorkingDirectory = "/home/bridger/Developer/steve";
      ExecStart = "${pkgs.nodePackages.npm}/bin/npx @anthropic-ai/claude-code@latest remote-control --spawn worktree --permission-mode bypassPermissions";
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
