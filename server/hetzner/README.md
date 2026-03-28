# Steve — NixOS on Hetzner Cloud

NixOS server for Minecraft with Node.js, Docker, and JDK 21.

## Deploy

```bash
nix run .#deploy
```

Prompts you to choose between a fresh install or applying config changes.

## 1. Create a server

```bash
hcloud server create \
  --name steve \
  --type cx22 \
  --image debian-13 \
  --location hel1 \
  --ssh-key bridger@nixos
```

Update the IP in `flake.nix`, then run `nix run .#deploy` → option 1.

## 2. Verify

```bash
ssh bridger@<server-ip> 'node --version'
```

## 3. Tear down

```bash
hcloud server delete steve
```

## Zellij

```bash
# First time
ssh steve
zellij --layout steve

# Reattach
zellij attach <session-name>
```

## Notes

- SSH key-only auth, no passwords. Root SSH is disabled.
- `bridger` user has passwordless sudo and is a trusted nix user.
