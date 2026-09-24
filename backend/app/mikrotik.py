from json import JSONDecodeError
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from .config import settings


class MikroTikREST:
    @property
    def base(self):
        return f"{settings.mikrotik_rest_scheme}://{settings.mikrotik_host}:{settings.mikrotik_rest_port}/rest"

    @property
    def auth(self):
        return (settings.mikrotik_username, settings.mikrotik_password)

    async def _request(self, method: str, path: str, json=None):
        try:
            async with httpx.AsyncClient(
                verify=settings.mikrotik_verify_tls,
                timeout=12.0,
                auth=self.auth,
            ) as client:
                r = await client.request(method, f"{self.base}/{path.lstrip('/')}", json=json)
            if r.status_code >= 400:
                detail = r.text[:800]
                raise HTTPException(
                    status_code=502,
                    detail=f"MikroTik REST API returned {r.status_code}: {detail}",
                )
            if not r.content:
                return None
            try:
                return r.json()
            except (JSONDecodeError, ValueError) as e:
                raise HTTPException(status_code=502, detail="MikroTik REST API returned invalid JSON") from e
        except httpx.HTTPError as e:
            detail = f"Cannot reach MikroTik REST API: {e}"
            if isinstance(e, httpx.ConnectError) and "CERTIFICATE_VERIFY_FAILED" in str(e):
                detail += (
                    " — the router is presenting a certificate the app does not trust. "
                    "If this is a self-signed certificate on a trusted private network, "
                    "open Config and uncheck 'Verify router TLS certificate'."
                )
            raise HTTPException(status_code=502, detail=detail) from e

    async def test_connection(self):
        resource = await self._request("GET", "system/resource")
        interface = await self.get_interface()
        row = resource[0] if isinstance(resource, list) and resource else (resource or {})
        return {
            "ok": True,
            "version": row.get("version"),
            "board": row.get("board-name"),
            "interface": interface.get("name"),
        }

    async def get_interface(self):
        data = await self._request("GET", "interface/wireguard")
        for item in data or []:
            if item.get("name") == settings.mikrotik_wg_interface:
                return item
        raise HTTPException(
            status_code=404,
            detail=f"WireGuard interface '{settings.mikrotik_wg_interface}' was not found on the MikroTik router.",
        )

    async def list_peers(self):
        data = await self._request("GET", "interface/wireguard/peers")
        return [
            p for p in (data or []) if p.get("interface") == settings.mikrotik_wg_interface
        ]

    async def create_peer(self, *, name: str, public_key: str, address: str):
        payload = {
            "interface": settings.mikrotik_wg_interface,
            "public-key": public_key,
            "allowed-address": f"{address}/32",
            "comment": name,
            "disabled": "false",
        }
        return await self._request("PUT", "interface/wireguard/peers", json=payload)

    async def set_peer_disabled(self, peer_id: str, disabled: bool):
        # RouterOS resource IDs are shaped like "*A". The asterisk is part
        # of the canonical ID and must remain literal in REST resource paths.
        escaped = quote(peer_id, safe="*")
        return await self._request(
            "PATCH",
            f"interface/wireguard/peers/{escaped}",
            json={"disabled": "true" if disabled else "false"},
        )

    async def delete_peer(self, peer_id: str):
        escaped = quote(peer_id, safe="*")
        return await self._request("DELETE", f"interface/wireguard/peers/{escaped}")


router = MikroTikREST()
