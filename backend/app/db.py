import os
import sqlite3
from contextlib import contextmanager

from cryptography.fernet import Fernet

from .config import settings

os.makedirs(settings.data_dir, mode=0o700, exist_ok=True)
os.chmod(settings.data_dir, 0o700)
DB_PATH = os.path.join(settings.data_dir, "wireguard-ui.db")
KEY_PATH = os.path.join(settings.data_dir, "fernet.key")


def _load_fernet() -> Fernet:
    if not os.path.exists(KEY_PATH):
        with open(KEY_PATH, "wb") as f:
            f.write(Fernet.generate_key())
        os.chmod(KEY_PATH, 0o600)
    with open(KEY_PATH, "rb") as f:
        return Fernet(f.read().strip())


FERNET = _load_fernet()
if os.path.exists(DB_PATH):
    os.chmod(DB_PATH, 0o600)


@contextmanager
def conn():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db():
    with conn() as c:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS managed_clients (
                public_key TEXT PRIMARY KEY,
                router_peer_id TEXT,
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                private_key_enc BLOB NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def save_client(public_key: str, router_peer_id: str, name: str, address: str, private_key: str):
    enc = FERNET.encrypt(private_key.encode("utf-8"))
    with conn() as c:
        c.execute(
            """
            INSERT INTO managed_clients(public_key, router_peer_id, name, address, private_key_enc)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(public_key) DO UPDATE SET
                router_peer_id=excluded.router_peer_id,
                name=excluded.name,
                address=excluded.address,
                private_key_enc=excluded.private_key_enc
            """,
            (public_key, router_peer_id, name, address, enc),
        )


def update_router_peer_id(public_key: str, router_peer_id: str):
    with conn() as c:
        c.execute(
            "UPDATE managed_clients SET router_peer_id=? WHERE public_key=?",
            (router_peer_id, public_key),
        )


def get_client(public_key: str):
    with conn() as c:
        row = c.execute(
            "SELECT * FROM managed_clients WHERE public_key=?", (public_key,)
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    d["private_key"] = FERNET.decrypt(d.pop("private_key_enc")).decode("utf-8")
    return d


def all_clients():
    with conn() as c:
        rows = c.execute("SELECT * FROM managed_clients ORDER BY created_at").fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["private_key"] = FERNET.decrypt(d.pop("private_key_enc")).decode("utf-8")
        result.append(d)
    return result


def delete_client(public_key: str):
    with conn() as c:
        c.execute("DELETE FROM managed_clients WHERE public_key=?", (public_key,))
