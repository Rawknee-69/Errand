# Host hardening

What the deployment assumes about the machine, and what to configure before it
faces the internet. The container side is already restricted: only Caddy has
published ports, the gateway and web run read-only with every capability
dropped, and no image contains a secret.

## Access: SSH only

- Disable password authentication and direct root login in
  `/etc/ssh/sshd_config.d/10-errand.conf`:

  ```
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  PermitRootLogin no
  AllowUsers deploy
  ```

  Then `sudo systemctl reload ssh`. Keep the current session open until a new
  key-based login succeeds.
- Use an SSH key with a passphrase; do not copy it to the server.
- Docker's published ports are the only application surface. Do not publish
  8787 or 3000; Caddy reaches them on the internal compose network.

## Firewall

Allow SSH and the two HTTP ports, deny the rest:

```sh
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

If a cloud provider has a security group, mirror the same rules there; UFW
cannot close a port the provider opens.

## Unattended upgrades

```sh
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

`/etc/apt/apt.conf.d/20auto-upgrades` should contain:

```
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
```

Reboot when `/var/run/reboot-required` appears. Docker is upgraded by the same
package manager; restart `docker compose up -d` afterwards so containers pick
up a new engine.

## Security headers

Caddy sets them on every response, before the route handlers:

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (HTTPS only) | no downgrade after the first visit |
| `X-Content-Type-Options` | `nosniff` | no MIME sniffing of an API response as HTML |
| `X-Frame-Options` | `DENY` | the console cannot be framed |
| `Content-Security-Policy` | `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'` | no injected script, no exfiltration to a third origin |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | no path leakage to upstream services |
| `Permissions-Policy` | camera, microphone and geolocation off | unused capabilities stay unavailable |
| `Server` | removed | no version banner |

The web server independently sends `nosniff`; Caddy is the layer that must
stay in front, so `docker compose ps` should never show a published `web` or
`gateway` port.

## Secrets never enter an image

- `.env` is mounted only as runtime environment by Compose. It is in
  `.dockerignore` and `.gitignore`, so it cannot be copied into a build context.
- Build args carry no credentials; `deploy/Dockerfile.gateway` and
  `deploy/Dockerfile.web` only copy source, the lockfile and manifests.
- `VAULT_KEY`, `HMAC_KEY`, `JWT_SECRET` and `OWNER_PASSPHRASE` are read from
  the host environment at start, never written to `/data`.
- Verify before pushing an image:

  ```sh
  docker compose config | grep -E 'VAULT_KEY|HMAC_KEY|JWT_SECRET'   # compose only, never a Dockerfile
  docker history --no-trunc errand-gateway | grep -i secret || true
  ```

- Rotate any secret that ever appeared in a commit, a log or a chat message.

## Key custody

`VAULT_KEY` is the one secret whose loss is unrecoverable: it unwraps every
connector credential. Store it in a password manager or secret store that is
backed up independently from the database, and give the runbook's restore step
the same value. The replica in `errand-replica` contains only ciphertext for
credentials and no copy of the key, so an attacker with the replica alone
cannot read connector secrets. They can still read operational rows; keep the
volume private.

## Container posture

| Control | Where |
|---|---|
| non-root user, read-only root filesystem for gateway and web | `compose.yaml` (`USER bun`, `read_only`) |
| all Linux capabilities dropped for gateway and web | `compose.yaml` (`cap_drop: ALL`) |
| no privilege escalation | `security_opt: no-new-privileges:true` |
| only Caddy published | `compose.yaml` (`ports` on `caddy` only) |
| pinned image and dependency versions | `compose.yaml`, `package.json`, `bun.lock` |
| health-gated start order | `depends_on` with `condition: service_healthy` |

The Litestream container runs as the image's default user and needs write
access to its own state and replica volumes; it has no published port.

## What is out of scope

TLS client certificates, SSO, multi-user accounts and an external WAF are not
part of this deployment. The gateway is a single-owner console; put it behind
the host firewall and a strong passphrase, not a shared team account.
