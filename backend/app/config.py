import json
import os
import secrets
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_username: str = "admin"
    app_password: str = ""
    jwt_secret: str = ""
    cookie_secure: bool = False
    session_hours: int = 12

    mikrotik_host: str = "192.168.88.1"
    mikrotik_username: str = "wg-ui"
    mikrotik_password: str = ""
    mikrotik_rest_scheme: str = "https"
    mikrotik_rest_port: int = 443
    mikrotik_verify_tls: bool = True
    mikrotik_wg_interface: str = "wireguard1"

    client_pool_cidr: str = "10.120.0.0/24"
    wg_endpoint_host: str = ""
    wg_client_dns: str = "1.1.1.1"
    wg_client_allowed_ips: str = "0.0.0.0/0"
    wg_persistent_keepalive: int = 25

    data_dir: str = "/data"


settings = Settings()

RUNTIME_FIELDS = {
    "app_username",
    "app_password",
    "cookie_secure",
    "session_hours",
    "mikrotik_host",
    "mikrotik_username",
    "mikrotik_password",
    "mikrotik_rest_scheme",
    "mikrotik_rest_port",
    "mikrotik_verify_tls",
    "mikrotik_wg_interface",
    "client_pool_cidr",
    "wg_endpoint_host",
    "wg_client_dns",
    "wg_client_allowed_ips",
    "wg_persistent_keepalive",
}


def _config_path() -> Path:
    return Path(settings.data_dir) / "config.json"


def load_runtime_config() -> None:
    path = _config_path()
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    for key, value in data.items():
        if key in RUNTIME_FIELDS or key == "jwt_secret":
            setattr(settings, key, value)


def validate_runtime_config(values: dict) -> None:
    username = str(values.get("app_username", "")).strip()
    password = str(values.get("app_password", ""))
    jwt_secret = str(values.get("jwt_secret", settings.jwt_secret))
    host = str(values.get("mikrotik_host", "")).strip()
    router_user = str(values.get("mikrotik_username", "")).strip()
    router_password = str(values.get("mikrotik_password", ""))
    scheme = str(values.get("mikrotik_rest_scheme", "https")).lower()
    interface = str(values.get("mikrotik_wg_interface", "")).strip()
    endpoint = str(values.get("wg_endpoint_host", "")).strip()

    if not username:
        raise ValueError("Admin username must not be empty")
    if len(password) < 12:
        raise ValueError("Admin password must be at least 12 characters")
    if jwt_secret and len(jwt_secret) < 32:
        raise ValueError("JWT secret must be at least 32 characters")
    if not host:
        raise ValueError("MikroTik host must not be empty")
    if not router_user:
        raise ValueError("MikroTik username must not be empty")
    if not router_password:
        raise ValueError("MikroTik password must not be empty")
    if scheme not in {"http", "https"}:
        raise ValueError("MikroTik REST scheme must be http or https")
    port = int(values.get("mikrotik_rest_port", 443))
    if port < 1 or port > 65535:
        raise ValueError("MikroTik REST port must be between 1 and 65535")
    if not interface:
        raise ValueError("WireGuard interface name must not be empty")
    if not str(values.get("client_pool_cidr", "")).strip():
        raise ValueError("Client pool CIDR must not be empty")
    if not endpoint:
        raise ValueError("WireGuard endpoint host must not be empty")
    hours = int(values.get("session_hours", 12))
    if hours < 1 or hours > 168:
        raise ValueError("Session hours must be between 1 and 168")
    keepalive = int(values.get("wg_persistent_keepalive", 25))
    if keepalive < 0 or keepalive > 65535:
        raise ValueError("Persistent keepalive must be between 0 and 65535")


def is_configured() -> bool:
    return (
        bool(settings.app_username.strip())
        and len(settings.app_password) >= 12
        and len(settings.jwt_secret) >= 32
        and bool(settings.mikrotik_host.strip())
        and bool(settings.mikrotik_username.strip())
        and bool(settings.mikrotik_password)
        and bool(settings.mikrotik_wg_interface.strip())
        and bool(settings.wg_endpoint_host.strip())
    )


def save_runtime_config(values: dict) -> None:
    merged = {field: getattr(settings, field) for field in RUNTIME_FIELDS}
    merged.update({k: v for k, v in values.items() if k in RUNTIME_FIELDS})

    jwt_secret = settings.jwt_secret if len(settings.jwt_secret) >= 32 else secrets.token_urlsafe(48)
    validation_values = {**merged, "jwt_secret": jwt_secret}
    validate_runtime_config(validation_values)

    os.makedirs(settings.data_dir, mode=0o700, exist_ok=True)
    path = _config_path()
    payload = {**merged, "jwt_secret": jwt_secret}
    temp = path.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    os.chmod(temp, 0o600)
    temp.replace(path)

    for key, value in payload.items():
        setattr(settings, key, value)


load_runtime_config()
