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

  # ── Environment ──

  home.sessionVariables = {
    TERM = "xterm-256color";
  };

  home.shellAliases = {
    claude = "npx @anthropic-ai/claude-code@latest --dangerously-skip-permissions";
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

  programs.zellij = {
    enable = true;
    enableBashIntegration = false;
  };

}
