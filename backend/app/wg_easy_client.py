from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from .models import WgServer


SESSION_LIFETIME_SECONDS = 3600


@dataclass
class WgClientInfo:
    id: int
    name: str
    expires_at: Optional[datetime]
    transfer_rx: int
    transfer_tx: int
    enabled: Optional[bool]
    is_active: bool


@dataclass
class TrafficSample:
    ts: datetime
    total_rx: int
    total_tx: int


# Простая in-memory история трафика по серверам (живёт до рестарта процесса)
TRAFFIC_HISTORY: Dict[int, List[TrafficSample]] = {}


def record_traffic_snapshot(server_id: int, total_rx: int, total_tx: int) -> None:
    now = datetime.utcnow()
    history = TRAFFIC_HISTORY.setdefault(server_id, [])
    history.append(TrafficSample(ts=now, total_rx=total_rx, total_tx=total_tx))
    # Держим историю только за последние 7 дней
    cutoff = now - timedelta(days=7)
    TRAFFIC_HISTORY[server_id] = [h for h in history if h.ts >= cutoff]


def get_traffic_delta_for_period(
    server_id: int, period_seconds: int
) -> Tuple[int, int]:
    """
    Возвращает примерный объём трафика за период как разницу между
    минимальным и максимальным значениями total_rx/tx в этом окне.
    """
    now = datetime.utcnow()
    history = TRAFFIC_HISTORY.get(server_id, [])
    if not history:
        return 0, 0

    cutoff = now - timedelta(seconds=period_seconds)
    window = [h for h in history if h.ts >= cutoff]
    if len(window) < 2:
        return 0, 0

    min_rx = min(h.total_rx for h in window)
    max_rx = max(h.total_rx for h in window)
    min_tx = min(h.total_tx for h in window)
    max_tx = max(h.total_tx for h in window)
    return max(0, max_rx - min_rx), max(0, max_tx - min_tx)


def get_traffic_history(
    server_id: int, period_seconds: int
) -> List[Dict[str, Any]]:
    now = datetime.utcnow()
    history = TRAFFIC_HISTORY.get(server_id, [])
    cutoff = now - timedelta(seconds=period_seconds)
    result = []
    for sample in history:
        if sample.ts >= cutoff:
            result.append(
                {
                    "timestamp": sample.ts.isoformat() + "Z",
                    "total_rx": sample.total_rx,
                    "total_tx": sample.total_tx,
                }
            )
    return result


async def _ensure_session_cookie(
    db: Session, server: WgServer
) -> Tuple[Optional[str], Optional[str]]:
    """
    Убедиться, что у нас есть актуальный cookie wg-easy для сервера.
    Возвращает (cookie_value, error_message).
    """
    # Используем "naive" время (UTC), чтобы совпадать с типом DateTime в SQLAlchemy
    now = datetime.utcnow()
    if server.session_cookie and server.session_expires_at:
        if server.session_expires_at > now + timedelta(seconds=60):
            return server.session_cookie, None

    # Нужно перелогиниться
    login_url = f"{server.base_url.rstrip('/')}/api/session"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                login_url,
                json={
                    "username": server.username,
                    "password": server.password,
                    "remember": True,
                },
            )
    except Exception as e:  # noqa: BLE001
        server.last_status_ok = False
        server.last_error = str(e)
        server.last_checked_at = now
        db.add(server)
        db.commit()
        return None, f"Login request failed: {e}"

    if resp.status_code != 200:
        server.last_status_ok = False
        server.last_error = f"Login failed with status {resp.status_code}"
        server.last_checked_at = now
        db.add(server)
        db.commit()
        return None, server.last_error

    set_cookie = resp.headers.get("set-cookie") or resp.headers.get("Set-Cookie")
    if not set_cookie or "wg-easy=" not in set_cookie:
        server.last_status_ok = False
        server.last_error = "wg-easy cookie not found in response"
        server.last_checked_at = now
        db.add(server)
        db.commit()
        return None, server.last_error

    # Небольшой парсинг значения cookie
    cookie_value = set_cookie.split("wg-easy=", 1)[1].split(";", 1)[0]
    server.session_cookie = cookie_value
    server.session_expires_at = now + timedelta(seconds=SESSION_LIFETIME_SECONDS)
    server.last_status_ok = True
    server.last_error = None
    server.last_checked_at = now
    db.add(server)
    db.commit()
    return cookie_value, None


async def check_server_health(db: Session, server: WgServer) -> Dict[str, Any]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return {"ok": False, "error": error or "No cookie"}

    url = f"{server.base_url.rstrip('/')}/api/client"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url,
                headers={
                    "accept": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        server.last_status_ok = False
        server.last_error = str(e)
        db.add(server)
        db.commit()
        return {"ok": False, "error": str(e)}

    if resp.status_code != 200:
        server.last_status_ok = False
        server.last_error = f"/api/client failed with status {resp.status_code}"
        db.add(server)
        db.commit()
        return {"ok": False, "error": server.last_error}

    server.last_status_ok = True
    server.last_error = None
    db.add(server)
    db.commit()

    data = resp.json()
    return {"ok": True, "clients_count": len(data)}


async def create_client(
    db: Session, server: WgServer, name: str, expires_at: Optional[datetime]
) -> Tuple[Optional[int], Optional[str]]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return None, error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client"
    # wg-easy ожидает поле expiresAt всегда; если нет даты – передаём null
    payload: Dict[str, Any] = {"name": name, "expiresAt": None}
    if expires_at is not None:
        # wg-easy ожидает ISO-строку с Z, например "2025-12-10T00:00:00.000Z"
        iso = expires_at.replace(tzinfo=timezone.utc).isoformat()
        if iso.endswith("+00:00"):
            iso = iso.replace("+00:00", "Z")
        payload["expiresAt"] = iso

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                json=payload,
                headers={
                    "accept": "application/json",
                    "content-type": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return None, str(e)

    if resp.status_code != 200:
        # Вернём текст ответа wg-easy, чтобы легче было понять причину
        return None, f"create client failed with status {resp.status_code}: {resp.text}"

    data = resp.json()
    if not data.get("success"):
        return None, "wg-easy did not return success"

    return int(data["clientId"]), None


async def list_clients(db: Session, server: WgServer) -> Tuple[Optional[List[WgClientInfo]], Optional[str]]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return None, error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url,
                headers={
                    "accept": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return None, str(e)

    if resp.status_code != 200:
        return None, f"/api/client failed with status {resp.status_code}"

    raw = resp.json()
    clients: List[WgClientInfo] = []
    for item in raw:
        expires = (
            datetime.fromisoformat(item["expiresAt"].replace("Z", "+00:00"))
            if item.get("expiresAt")
            else None
        )
        latest_handshake = item.get("latestHandshakeAt")
        is_active = bool(latest_handshake)
        clients.append(
            WgClientInfo(
                id=item["id"],
                name=item["name"],
                expires_at=expires,
                transfer_rx=int(item.get("transferRx", 0) or 0),
                transfer_tx=int(item.get("transferTx", 0) or 0),
                enabled=bool(item.get("enabled")) if "enabled" in item else None,
                is_active=is_active,
            )
        )
    return clients, None


async def fetch_qrcode_svg(
    db: Session, server: WgServer, client_id: int
) -> Tuple[Optional[bytes], Optional[str]]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return None, error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client/{client_id}/qrcode.svg"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url,
                headers={
                    "accept": "image/svg+xml",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return None, str(e)

    if resp.status_code != 200:
        return None, f"/api/client/{client_id}/qrcode.svg failed with status {resp.status_code}"

    return resp.content, None


async def get_client_raw(
    db: Session, server: WgServer, client_id: int
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return None, error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client/{client_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url,
                headers={
                    "accept": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return None, str(e)

    if resp.status_code != 200:
        return None, f"get client failed with status {resp.status_code}: {resp.text}"

    return resp.json(), None


async def update_client_expires(
    db: Session, server: WgServer, client_id: int, expires_at: Optional[datetime]
) -> Optional[str]:
    """
    Обновляет только поле expiresAt клиента.
    """
    data, error = await get_client_raw(db, server, client_id)
    if error or data is None:
        return error or "Failed to load client"

    if expires_at is None:
        data["expiresAt"] = None
    else:
        iso = expires_at.replace(tzinfo=timezone.utc).isoformat()
        if iso.endswith("+00:00"):
            iso = iso.replace("+00:00", "Z")
        data["expiresAt"] = iso

    cookie, error2 = await _ensure_session_cookie(db, server)
    if error2 or not cookie:
        return error2 or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client/{client_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                json=data,
                headers={
                    "accept": "application/json",
                    "content-type": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return str(e)

    if resp.status_code != 200:
        return f"update client failed with status {resp.status_code}: {resp.text}"

    return None


async def _post_simple_action(
    db: Session, server: WgServer, client_id: int, action: str
) -> Optional[str]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client/{client_id}/{action}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url,
                headers={
                    "accept": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return str(e)

    if resp.status_code != 200:
        return f"{action} failed with status {resp.status_code}: {resp.text}"
    return None


async def disable_client(db: Session, server: WgServer, client_id: int) -> Optional[str]:
    return await _post_simple_action(db, server, client_id, "disable")


async def enable_client(db: Session, server: WgServer, client_id: int) -> Optional[str]:
    return await _post_simple_action(db, server, client_id, "enable")


async def delete_client(db: Session, server: WgServer, client_id: int) -> Optional[str]:
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client/{client_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                url,
                headers={
                    "accept": "application/json",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return str(e)

    if resp.status_code != 200:
        return f"delete client failed with status {resp.status_code}: {resp.text}"
    return None


async def fetch_client_configuration(
    db: Session, server: WgServer, client_id: int
) -> Tuple[Optional[bytes], Optional[str]]:
    """
    Скачивает конфигурационный файл клиента (WireGuard .conf).
    Возвращает (content_bytes, error_message).
    """
    cookie, error = await _ensure_session_cookie(db, server)
    if error or not cookie:
        return None, error or "No cookie"

    url = f"{server.base_url.rstrip('/')}/api/client/{client_id}/configuration"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                url,
                headers={
                    "accept": "application/octet-stream",
                    "cookie": f"wg-easy={cookie}",
                },
            )
    except Exception as e:  # noqa: BLE001
        return None, str(e)

    if resp.status_code != 200:
        return None, f"get configuration failed with status {resp.status_code}: {resp.text}"

    return resp.content, None



