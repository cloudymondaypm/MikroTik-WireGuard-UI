from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_username: str = "admin"
    app_password: str = ""
    jwt_secret: str = ""
    cookie_secure: bool = False
    session_hours: int = 12

    mikrotik_host: str = "10.10.1.1"
    mikrotik_username: str = "wg-ui"
    mikrotik_password: str = ""
    mikrotik_rest_scheme: str = "https"
    mikrotik_rest_port: int = 443
    mikrotik_verify_tls: bool = True
    mikrotik_wg_interface: str = "wireguard1"

    client_pool_cidr: str = "10.120.0.0/24"
    wg_endpoint_host: str = ""
    wg_client_dns: str = "1.1.1.1"
    wg_client_allowed_ips: str = "0.0.0.0/0, ::/0"
    wg_persistent_keepalive: int = 25

    data_dir: str = "/data"

    @model_validator(mode="after")
    def validate_security(self):
        if not self.app_username.strip():
            raise ValueError("APP_USERNAME must not be empty")
        if len(self.app_password) < 12:
            raise ValueError("APP_PASSWORD must be at least 12 characters")
        if len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        if self.session_hours < 1 or self.session_hours > 168:
            raise ValueError("SESSION_HOURS must be between 1 and 168")
        if self.mikrotik_rest_scheme not in {"http", "https"}:
            raise ValueError("MIKROTIK_REST_SCHEME must be http or https")
        if self.mikrotik_rest_port < 1 or self.mikrotik_rest_port > 65535:
            raise ValueError("MIKROTIK_REST_PORT must be a valid TCP port")
        return self


settings = Settings()
