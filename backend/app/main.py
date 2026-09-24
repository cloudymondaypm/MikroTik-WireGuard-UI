import base64
import binascii
import ipaddress
import json
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from pydantic import BaseModel, Field, model_validator

from .config import is_configured, save_runtime_config, settings
from .db import (
    all_clients,
    delete_client,
    get_client,
    init_db,
    save_client,
    update_router_peer_id,
)
from .mikrotik import router

app = FastAPI(title="MikroTik WireGuard UI", version="0.1.0")


class LoginRequest(BaseModel):
    username: str
    password: str


class ClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    address: str | None = None


class ToggleRequest(BaseModel):
    enabled: bool


class ListenPortRequest(BaseModel):
    listen_port: int = Field(ge=1, le=65535)


class AppConfigRequest(BaseModel):
    app_username: str = Field(default="admin", min_length=1, max_length=80)
    app_password: str = ""
    cookie_secure: bool = False
    session_hours: int = Field(default=12, ge=1, le=168)

    mikrotik_host: str = Field(min_length=1, max_length=255)
    mikrotik_username: str = Field(min_length=1, max_length=80)
    mikrotik_password: str = ""
    mikrotik_rest_scheme: str = "https"
    mikrotik_rest_port: int = Field(default=443, ge=1, le=65535)
    mikrotik_verify_tls: bool = True
    mikrotik_wg_interface: str = Field(default="wireguard1", min_length=1, max_length=80)

    client_pool_cidr: str = Field(default="10.120.0.0/24", min_length=1, max_length=64)
    wg_endpoint_host: str = Field(min_length=1, max_length=255)
    wg_client_dns: str = Field(default="1.1.1.1", max_length=255)
    wg_client_allowed_ips: str = Field(default="0.0.0.0/0", min_length=1, max_length=512)
    wg_persistent_keepalive: int = Field(default=25, ge=0, le=65535)


class RestoreClient(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    address: str
    private_key: str
    public_key: str

    @model_validator(mode="after")
    def validate_restore_client(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("name must not be blank")
        _pool_host(self.address)
        private = X25519PrivateKey.from_private_bytes(_key_bytes(self.private_key))
        expected = private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        if _key_bytes(self.public_key) != expected:
            raise ValueError("public_key does not match private_key")
        return self


class RestorePayload(BaseModel):
    version: int = 1
    clients: list[RestoreClient]


def require_auth(wg_session: str | None = Cookie(default=None)):
    if not is_configured():
        raise HTTPException(status_code=503, detail="Application setup is not complete")
    if not wg_session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(wg_session, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("sub") != settings.app_username:
            raise HTTPException(status_code=401, detail="Invalid session")
        return payload
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail="Invalid session") from e


@app.on_event("startup")
def startup():
    init_db()


@app.get("/healthz")
def healthz():
    return {"ok": True, "configured": is_configured()}


@app.get("/api/setup/status")
def setup_status():
    return {"configured": is_configured()}


def _public_settings():
    return {
        "app_username": settings.app_username,
        "app_password_set": bool(settings.app_password),
        "cookie_secure": settings.cookie_secure,
        "session_hours": settings.session_hours,
        "mikrotik_host": settings.mikrotik_host,
        "mikrotik_username": settings.mikrotik_username,
        "mikrotik_password_set": bool(settings.mikrotik_password),
        "mikrotik_rest_scheme": settings.mikrotik_rest_scheme,
        "mikrotik_rest_port": settings.mikrotik_rest_port,
        "mikrotik_verify_tls": settings.mikrotik_verify_tls,
        "mikrotik_wg_interface": settings.mikrotik_wg_interface,
        "client_pool_cidr": settings.client_pool_cidr,
        "wg_endpoint_host": settings.wg_endpoint_host,
        "wg_client_dns": settings.wg_client_dns,
        "wg_client_allowed_ips": settings.wg_client_allowed_ips,
        "wg_persistent_keepalive": settings.wg_persistent_keepalive,
    }


@app.post("/api/setup")
def initial_setup(body: AppConfigRequest):
    if is_configured():
        raise HTTPException(status_code=409, detail="Application is already configured")
    values = body.model_dump()
    try:
        save_runtime_config(values)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"ok": True}


@app.get("/api/settings")
def get_settings(_: dict = Depends(require_auth)):
    return _public_settings()


@app.patch("/api/settings")
def update_settings(body: AppConfigRequest, _: dict = Depends(require_auth)):
    values = body.model_dump()
    if not values["app_password"]:
        values["app_password"] = settings.app_password
    if not values["mikrotik_password"]:
        values["mikrotik_password"] = settings.mikrotik_password

    old_username = settings.app_username
    old_password = settings.app_password
    try:
        save_runtime_config(values)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    return {
        "ok": True,
        "reauth_required": old_username != settings.app_username or old_password != settings.app_password,
    }


@app.post("/api/settings/test")
async def test_settings(_: dict = Depends(require_auth)):
    return await router.test_connection()


@app.patch("/api/settings/wireguard-port")
async def set_wireguard_port(body: ListenPortRequest, _: dict = Depends(require_auth)):
    await router.set_listen_port(body.listen_port)
    return {"ok": True, "listen_port": body.listen_port}


@app.post("/api/auth/login")
def login(body: LoginRequest, response: Response):
    if not is_configured():
        raise HTTPException(status_code=409, detail="Complete first-time setup before signing in")
    username_ok = secrets.compare_digest(body.username, settings.app_username)
    password_ok = secrets.compare_digest(body.password, settings.app_password)
    if not (username_ok and password_ok):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": settings.app_username, "iat": now, "exp": now + timedelta(hours=settings.session_hours)},
        settings.jwt_secret,
        algorithm="HS256",
    )
    response.set_cookie(
        "wg_session",
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_hours * 3600,
        path="/",
    )
    return {"ok": True}


@app.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie("wg_session", path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(_: dict = Depends(require_auth)):
    return {"username": settings.app_username}


def _wg_keypair():
    private = X25519PrivateKey.generate()
    private_raw = private.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_raw = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return base64.b64encode(private_raw).decode(), base64.b64encode(public_raw).decode()


def _first_ipv4(value: str | None):
    if not value:
        return None
    for part in value.split(","):
        part = part.strip()
        try:
            iface = ipaddress.ip_interface(part)
            if iface.version == 4:
                return str(iface.ip)
        except ValueError:
            continue
    return None


def _key_bytes(value: str) -> bytes:
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as e:
        raise ValueError("WireGuard keys must be strict base64") from e
    if len(raw) != 32:
        raise ValueError("WireGuard keys must decode to 32 bytes")
    return raw


def _pool_host(value: str) -> str:
    try:
        ip = ipaddress.ip_address(value)
        pool = ipaddress.ip_network(settings.client_pool_cidr, strict=False)
    except ValueError as e:
        raise ValueError("address must be a valid IPv4 address") from e
    if ip.version != 4 or ip not in pool or ip in {pool.network_address, pool.broadcast_address}:
        raise ValueError(f"address must be a usable host inside {pool}")
    return str(ip)


def _peer_enabled(peer):
    return str(peer.get("disabled", "false")).lower() not in {"true", "yes"}


async def _allocate_address(peers):
    network = ipaddress.ip_network(settings.client_pool_cidr, strict=False)
    used = {_first_ipv4(p.get("allowed-address")) for p in peers}
    # Reserve the first usable address for the MikroTik WireGuard interface.
    for idx, host in enumerate(network.hosts()):
        if idx == 0:
            continue
        ip = str(host)
        if ip not in used:
            return ip
    raise HTTPException(status_code=409, detail="No free client addresses remain in CLIENT_POOL_CIDR")


@app.get("/api/clients")
async def list_clients(_: dict = Depends(require_auth)):
    peers = await router.list_peers()
    result = []
    for peer in peers:
        public_key = peer.get("public-key", "")
        managed = get_client(public_key) if public_key else None
        result.append(
            {
                "id": peer.get(".id"),
                "name": peer.get("comment") or (managed or {}).get("name") or "Unnamed Client",
                "address": _first_ipv4(peer.get("allowed-address")) or "—",
                "enabled": _peer_enabled(peer),
                "managed": bool(managed),
                "publicKey": public_key,
                "lastHandshake": peer.get("last-handshake"),
                "rx": peer.get("rx"),
                "tx": peer.get("tx"),
            }
        )
    return result


@app.post("/api/clients")
async def create_client(body: ClientCreate, _: dict = Depends(require_auth)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Client name must not be blank")
    peers = await router.list_peers()
    if body.address:
        try:
            address = _pool_host(body.address)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        used = {_first_ipv4(p.get("allowed-address")) for p in peers}
        if address in used:
            raise HTTPException(status_code=409, detail="That client address is already in use")
    else:
        address = await _allocate_address(peers)

    private_key, public_key = _wg_keypair()
    created = await router.create_peer(name=name, public_key=public_key, address=address)
    peer_id = (created or {}).get(".id", "")
    if not peer_id:
        # Some RouterOS builds return a minimal body; resolve the ID from the live peer list.
        for p in await router.list_peers():
            if p.get("public-key") == public_key:
                peer_id = p.get(".id", "")
                break
    if not peer_id:
        raise HTTPException(status_code=502, detail="MikroTik created the peer but did not return its ID")
    try:
        save_client(public_key, peer_id, name, address, private_key)
    except Exception as e:
        try:
            await router.delete_peer(peer_id)
        except Exception:
            pass
        raise HTTPException(status_code=500, detail="Client was not saved; the router peer was rolled back") from e
    return {"id": peer_id, "name": name, "address": address, "enabled": True, "managed": True}


@app.patch("/api/clients/{peer_id}/toggle")
async def toggle_client(peer_id: str, body: ToggleRequest, _: dict = Depends(require_auth)):
    await router.set_peer_disabled(peer_id, not body.enabled)
    return {"ok": True}


@app.delete("/api/clients/{peer_id}")
async def remove_client(peer_id: str, _: dict = Depends(require_auth)):
    peers = await router.list_peers()
    target = next((p for p in peers if p.get(".id") == peer_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Peer not found")
    await router.delete_peer(peer_id)
    if target.get("public-key"):
        delete_client(target["public-key"])
    return {"ok": True}


async def _get_peer_and_secret(peer_id: str):
    peers = await router.list_peers()
    peer = next((p for p in peers if p.get(".id") == peer_id), None)
    if not peer:
        raise HTTPException(status_code=404, detail="Peer not found")
    public_key = peer.get("public-key", "")
    managed = get_client(public_key) if public_key else None
    if not managed:
        raise HTTPException(
            status_code=409,
            detail="This peer was not created by this app, so its client private key is not available for QR/config export.",
        )
    return peer, managed


def _build_config(managed, interface):
    if not settings.wg_endpoint_host:
        raise HTTPException(status_code=409, detail="WG_ENDPOINT_HOST is not configured")
    server_pub = interface.get("public-key")
    listen_port = interface.get("listen-port")
    if not server_pub or not listen_port:
        raise HTTPException(status_code=502, detail="MikroTik WireGuard interface is missing public-key or listen-port")
    dns_line = f"DNS = {settings.wg_client_dns}\n" if settings.wg_client_dns else ""
    keepalive = (
        f"PersistentKeepalive = {settings.wg_persistent_keepalive}\n"
        if settings.wg_persistent_keepalive > 0
        else ""
    )
    return (
        "[Interface]\n"
        f"PrivateKey = {managed['private_key']}\n"
        f"Address = {managed['address']}/32\n"
        f"{dns_line}\n"
        "[Peer]\n"
        f"PublicKey = {server_pub}\n"
        f"AllowedIPs = {settings.wg_client_allowed_ips}\n"
        f"Endpoint = {settings.wg_endpoint_host}:{listen_port}\n"
        f"{keepalive}"
    )


@app.get("/api/clients/{peer_id}/config")
async def client_config(peer_id: str, _: dict = Depends(require_auth)):
    _, managed = await _get_peer_and_secret(peer_id)
    interface = await router.get_interface()
    return Response(
        _build_config(managed, interface),
        media_type="text/plain",
        headers={"Cache-Control": "no-store", "Content-Disposition": "attachment; filename=wireguard.conf"},
    )


@app.get("/api/backup")
async def backup(_: dict = Depends(require_auth)):
    clients = all_clients()
    return Response(
        content=json.dumps({
        "version": 1,
        "warning": "Contains WireGuard client private keys. Store securely.",
        "clients": [
            {
                "name": c["name"],
                "address": c["address"],
                "private_key": c["private_key"],
                "public_key": c["public_key"],
            }
            for c in clients
        ]}),
        media_type="application/json",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/restore")
async def restore(body: RestorePayload, _: dict = Depends(require_auth)):
    peers = await router.list_peers()
    by_pub = {p.get("public-key"): p for p in peers}
    existing_addresses = {
        _first_ipv4(p.get("allowed-address")) for p in peers if p.get("public-key") not in {i.public_key for i in body.clients}
    }
    seen_addresses = set(existing_addresses)
    seen_keys = set()
    for item in body.clients:
        if item.public_key in seen_keys:
            raise HTTPException(status_code=409, detail="Backup contains duplicate public keys")
        seen_keys.add(item.public_key)
        if item.address in seen_addresses:
            raise HTTPException(status_code=409, detail=f"Address {item.address} is already in use")
        seen_addresses.add(item.address)
    restored = 0
    for item in body.clients:
        peer = by_pub.get(item.public_key)
        if not peer:
            created = await router.create_peer(name=item.name, public_key=item.public_key, address=item.address)
            peer_id = (created or {}).get(".id", "")
            if not peer_id:
                refreshed = await router.list_peers()
                peer = next((p for p in refreshed if p.get("public-key") == item.public_key), None)
                peer_id = (peer or {}).get(".id", "")
        else:
            peer_id = peer.get(".id", "")
            router_address = _first_ipv4(peer.get("allowed-address"))
            if router_address and router_address != item.address:
                raise HTTPException(status_code=409, detail=f"Existing peer address does not match backup for {item.name}")
        if not peer_id:
            raise HTTPException(status_code=502, detail="MikroTik created a peer but did not return its ID")
        save_client(item.public_key, peer_id, item.name, item.address, item.private_key)
        update_router_peer_id(item.public_key, peer_id)
        restored += 1
    return {"ok": True, "restored": restored}
