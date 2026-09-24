# MikroTik WireGuard UI

A WireGuard Easy-style web interface for managing an **existing MikroTik RouterOS v7 WireGuard interface**.

The application does not run a second WireGuard server. MikroTik remains the WireGuard router. The app provides a clean web UI for peer creation, QR/config export, enable/disable, deletion, traffic status, backup/restore, and configuration.

## Features

- First-run web setup wizard — no router credentials need to be committed to Git.
- In-app **Config** button for changing MikroTik connection and WireGuard client settings.
- Reads the live WireGuard peer list from RouterOS.
- Creates WireGuard client key pairs and sends only the client public key to MikroTik.
- Generates QR codes and downloadable WireGuard client configurations.
- Shows online/offline state, latest handshake, receive/transmit totals, and live transfer rate.
- Enables, disables, and removes MikroTik WireGuard peers.
- Backup/restore for app-managed client metadata and keys.
- Docker Compose deployment.
- Next.js/React frontend + FastAPI backend.

## Architecture

```text
Browser
   |
   v
Next.js / React
   |
   v
FastAPI
   |
   v
RouterOS REST API
   |
   v
MikroTik WireGuard interface
```

The application itself does not forward VPN traffic.

---

# Quick Install

## 1. Requirements

You need:

- A MikroTik router running RouterOS v7.
- An existing or new WireGuard interface on the MikroTik.
- A Linux host, VM, container host, or server with Docker and Docker Compose.
- Network connectivity from the Docker host to the MikroTik management IP.
- A public IP or DDNS hostname if remote WireGuard clients will connect through the internet.

## 2. Clone and start

```bash
git clone https://github.com/cloudymondaypm/MikroTik-WireGuard-UI.git
cd MikroTik-WireGuard-UI
docker compose up -d --build
```

The default web port is TCP **80**.

To use another port, copy the safe example file and change only `APP_PORT`:

```bash
cp .env.example .env
nano .env
docker compose up -d
```

Example:

```env
APP_PORT=8080
```

Then open:

```text
http://YOUR-SERVER-IP
```

A fresh installation automatically sends you to the **First-time setup** page.

---

# Step-by-step: Link the app to a MikroTik router

The application talks to RouterOS through its REST API. RouterOS REST is provided by the `www-ssl` HTTPS service, or by `www` for HTTP. HTTPS is strongly recommended.

## Step 1 — Create or identify the MikroTik WireGuard interface

Open **WinBox → WireGuard**, or use the RouterOS terminal.

Example only:

```routeros
/interface/wireguard/add name=wireguard1 listen-port=13231
```

Assign the router an address inside the VPN client subnet.

Example:

```routeros
/ip/address/add address=10.120.0.1/24 interface=wireguard1
```

You may use a different subnet. Enter the matching client pool later in the app.

> The app reserves the first usable address in the configured client pool for the MikroTik WireGuard interface and starts automatically allocated clients from the next usable address.

## Step 2 — Create a dedicated RouterOS user group

Do not use your main router administrator account for the application.

Create a restricted group with the permissions needed to read RouterOS state, modify WireGuard peers, and access REST:

```routeros
/user/group/add name=wg-ui policy=read,write,rest-api
```

## Step 3 — Create the application user

Choose a strong unique password.

```routeros
/user/add name=wg-ui group=wg-ui password="CHANGE-THIS-TO-A-STRONG-PASSWORD"
```

For better security, restrict the account to the IP address of the machine running this application.

Example:

```routeros
/user/set [find name=wg-ui] address=192.168.88.10/32
```

Replace `192.168.88.10` with the actual IP of your application host.

## Step 4 — Enable RouterOS HTTPS / REST

Recommended:

```routeros
/ip/service/enable www-ssl
```

The REST endpoint is then:

```text
https://ROUTER-IP/rest
```

RouterOS REST uses the same RouterOS username/password through HTTP Basic Authentication.

For production, configure a certificate trusted by the application host. If you use a self-signed certificate on a trusted private management network, the app can be configured with **Verify TLS certificate** disabled, but certificate verification is safer when available.

HTTP via the RouterOS `www` service can also expose REST on supported RouterOS v7 releases, but MikroTik recommends HTTPS because HTTP exposes credentials to passive network capture.

## Step 5 — Restrict management access

Restrict `www-ssl` so only your trusted management network or application host can connect.

Example:

```routeros
/ip/service/set www-ssl address=192.168.88.10/32
```

Replace the example address with the IP or subnet that should be allowed.

A firewall rule can provide stronger network-level restriction when required.

## Step 6 — Test RouterOS REST manually

From the Docker host:

```bash
curl -k -u wg-ui:'YOUR-PASSWORD' https://ROUTER-IP/rest/system/resource
```

If your router has a trusted certificate, remove `-k`.

A successful request returns RouterOS system information as JSON.

## Step 7 — Complete the app setup wizard

Open the web UI. On a fresh install, enter:

### Web Admin

- **Username** — login name for this web application.
- **Password** — at least 12 characters.
- **Session hours** — web login lifetime.
- **Secure cookie** — enable when the application is served over HTTPS.

### MikroTik RouterOS REST API

- **Router host / IP** — management IP or hostname of the MikroTik.
- **REST username** — the dedicated RouterOS user created above.
- **REST password** — its password.
- **WireGuard interface** — for example `wireguard1`.
- **REST scheme** — normally `https`.
- **REST port** — normally the port configured for `www-ssl`.
- **Verify TLS certificate** — recommended when the router certificate is trusted.

### WireGuard Client Defaults

- **Client pool CIDR** — subnet used for WireGuard clients, for example `10.120.0.0/24`.
- **Public endpoint / DDNS** — public IP or DNS hostname that WireGuard clients use to reach the MikroTik.
- **DNS server** — DNS server placed in generated client configs.
- **Allowed IPs** — networks routed through the VPN.
  - `0.0.0.0/0` = full-tunnel IPv4.
  - A private subnet such as `192.168.0.0/16` = split tunnel.
- **Persistent keepalive** — normally `25` seconds for roaming/NAT clients.

Click **Finish setup**, then sign in.

## Step 8 — Verify the connection

After login:

1. Click **Config** in the top-right corner.
2. Click **Test connection**.
3. The app should display the RouterOS version, board model, and selected WireGuard interface.

If the test fails, verify the router address, REST port, TLS setting, user permissions, and firewall rules.

---

# Using the app

## Create a client

Click **New**, enter a client name, and optionally specify an address.

If no address is provided, the app chooses the next unused address from the configured client pool.

The app:

1. Generates the client's WireGuard private/public key pair.
2. Adds the public key as a peer on MikroTik.
3. Stores the client metadata/private key in the application's persistent data volume.
4. Makes the QR code and `.conf` download available.

## Existing MikroTik peers

Peers created outside this application still appear in the client list and can be enabled, disabled, or removed.

The app cannot generate a QR code or client config for an externally created peer because the peer's client private key is not available to the application.

## Change configuration

Click **Config** at any time.

Passwords are never returned to the browser. On an existing installation, leave a password field blank to keep its current value.

## Backup

The **Backup** file contains app-managed WireGuard client private keys. Treat backups like credentials and store them securely.

---

# Where configuration is stored

Fresh installations do **not** require MikroTik credentials in `.env`.

Runtime configuration is stored inside the persistent Docker volume:

```text
wg-ui-data
```

The backend writes its private configuration under `/data` in that volume with restrictive file permissions.

The repository intentionally contains no deployment-specific router address, DDNS hostname, RouterOS password, web password, or JWT secret.

`.env.example` is optional and contains only safe placeholders/examples. The real `.env` file is ignored by Git.

---

# Updating

```bash
git pull
docker compose up -d --build
```

The Docker data volume remains intact, so normal image rebuilds do not remove the saved app configuration or managed client keys.

---

# Resetting a local installation

To remove **all local application configuration and app-managed client key data**, stop the stack and remove its Docker volume.

> This is destructive. Back up first if you need the generated client private keys later.

```bash
docker compose down
docker volume ls
```

Find the project's `wg-ui-data` volume, then remove it explicitly:

```bash
docker volume rm YOUR_PROJECT_WG_UI_DATA_VOLUME
```

Start again:

```bash
docker compose up -d
```

The first-time setup wizard will appear again.

This does **not** automatically delete peers already stored on the MikroTik router.

---

# Security recommendations

- Use a dedicated RouterOS account instead of the router's primary administrator account.
- Restrict that account and `www-ssl` to the application host or trusted management subnet.
- Prefer HTTPS for RouterOS REST.
- Use a trusted certificate when possible.
- Never expose RouterOS REST directly to the public internet.
- Put this web application behind HTTPS before exposing it beyond a trusted LAN.
- Enable **Secure cookie** when the application is served directly over HTTPS.
- Keep the application data volume and backup files private.
- Never commit a real `.env`, passwords, tokens, private keys, or backup files.

## RouterOS documentation

- MikroTik RouterOS REST API documentation: https://help.mikrotik.com/docs/spaces/ROS/pages/47579162/REST+API
- MikroTik RouterOS user/group policies: https://help.mikrotik.com/docs/spaces/ROS/pages/8978504/User
- MikroTik RouterOS services: https://help.mikrotik.com/docs/spaces/ROS/pages/103841820/Services
