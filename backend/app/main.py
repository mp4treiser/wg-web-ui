import io
import zipfile
from datetime import timedelta
from typing import Dict, List, Set

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from . import schemas
from .database import Base, engine, get_db
from .deps import get_current_admin
from .models import AdminUser, LogicalUser, UserServerBinding, WgServer
from .security import create_access_token, get_password_hash, verify_password
from .wg_easy_client import (
    check_server_health,
    create_client,
    delete_client,
    disable_client,
    enable_client,
    fetch_client_configuration,
    fetch_qrcode_svg,
    get_traffic_delta_for_period,
    get_traffic_history,
    list_clients,
    record_traffic_snapshot,
    update_client_expires,
)


Base.metadata.create_all(bind=engine)

app = FastAPI(title="WG Easy Admin Panel API", version="0.1.0")

# CORS: для dev разрешаем любой Origin, но корректно работаем с credentials
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/admin/register", response_model=schemas.AdminUserOut)
def register_admin(
    payload: schemas.AdminUserCreate,
    db: Session = Depends(get_db),
):
    """
    Регистрация администратора.
    - Если в системе ещё нет админов, доступно без авторизации (инициализация).
    - Если админы уже есть, то требует авторизации текущего админа (через Swagger можно
      сначала залогиниться, получить cookie, а затем вызвать этот эндпоинт).
    """
    existing_count = db.query(AdminUser).count()
    if existing_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration disabled after first admin is created",
        )

    if db.query(AdminUser).filter(AdminUser.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = AdminUser(
        email=payload.email,
        password_hash=get_password_hash(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=schemas.AdminUserOut)
def login_admin(
    payload: schemas.AdminUserCreate,
    response: Response,
    db: Session = Depends(get_db),
):
    user = db.query(AdminUser).filter(AdminUser.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    access_token = create_access_token({"sub": str(user.id)}, expires_delta=timedelta(hours=12))
    # HttpOnly cookie
    response.set_cookie(
        "access_token",
        access_token,
        httponly=True,
        max_age=12 * 3600,
        samesite="lax",
    )
    return user


@app.post("/auth/logout")
def logout_admin(response: Response):
    response.delete_cookie("access_token")
    return {"success": True}


@app.get("/me", response_model=schemas.AdminUserOut)
def get_me(current_admin: AdminUser = Depends(get_current_admin)):
    return current_admin


@app.post("/servers", response_model=schemas.ServerOut)
def create_server(
    payload: schemas.ServerCreate,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = WgServer(
        name=payload.name,
        base_url=str(payload.base_url),
        username=payload.username,
        password=payload.password,
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@app.get("/servers", response_model=List[schemas.ServerOut])
def list_servers(
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    servers = db.query(WgServer).order_by(WgServer.id).all()
    return servers


@app.patch("/servers/{server_id}", response_model=schemas.ServerOut)
def update_server(
    server_id: int,
    payload: schemas.ServerUpdate,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, field, value)

    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@app.delete("/servers/{server_id}")
def delete_server(
    server_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    # Удалим все привязки пиров к этому серверу
    bindings = (
        db.query(UserServerBinding)
        .filter(UserServerBinding.server_id == server.id)
        .all()
    )
    for b in bindings:
        db.delete(b)
    db.delete(server)
    db.commit()
    return {"success": True}


@app.post("/servers/{server_id}/check")
async def check_server(
    server_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    result = await check_server_health(db, server)
    return result


@app.post("/users", response_model=schemas.LogicalUserOut)
def create_logical_user(
    payload: schemas.LogicalUserCreate,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = LogicalUser(name=payload.name, note=payload.note)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get("/users", response_model=List[schemas.LogicalUserOut])
def list_logical_users(
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    users = db.query(LogicalUser).order_by(LogicalUser.id).all()
    return users


@app.get("/users/{user_id}", response_model=schemas.LogicalUserWithBindings)
def get_logical_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = db.query(LogicalUser).filter(LogicalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.post(
    "/users/{user_id}/servers",
    response_model=schemas.UserServerBindingOut,
)
async def attach_user_to_server(
    user_id: int,
    payload: schemas.UserServerBindingCreate,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = db.query(LogicalUser).filter(LogicalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    server = db.query(WgServer).filter(WgServer.id == payload.server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    client_name = user.name
    client_id, error = await create_client(db, server, client_name, payload.expires_at)
    if error or client_id is None:
        raise HTTPException(status_code=400, detail=error or "Failed to create client")

    binding = UserServerBinding(
        logical_user_id=user.id,
        server_id=server.id,
        wg_client_id=client_id,
        wg_client_name=client_name,
        expires_at=payload.expires_at,
    )
    db.add(binding)
    db.commit()
    db.refresh(binding)
    return binding


@app.get(
    "/users/{user_id}/servers",
    response_model=List[schemas.UserServerBindingOut],
)
def list_user_bindings(
    user_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    bindings = (
        db.query(UserServerBinding)
        .filter(UserServerBinding.logical_user_id == user_id)
        .order_by(UserServerBinding.id)
        .all()
    )
    return bindings


@app.get(
    "/users/{user_id}/servers/status",
    response_model=List[schemas.UserServerBindingWithStatusOut],
)
async def list_user_bindings_with_status(
    user_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    bindings = (
        db.query(UserServerBinding)
        .filter(UserServerBinding.logical_user_id == user_id)
        .order_by(UserServerBinding.id)
        .all()
    )
    if not bindings:
        return []

    # Группируем привязки по серверу
    by_server: Dict[int, List[UserServerBinding]] = {}
    for b in bindings:
        by_server.setdefault(b.server_id, []).append(b)

    result: List[schemas.UserServerBindingWithStatusOut] = []

    for server_id, server_bindings in by_server.items():
        server = db.query(WgServer).filter(WgServer.id == server_id).first()
        enabled_map: Dict[int, bool] = {}
        if server:
            clients, error = await list_clients(db, server)
            if not error and clients is not None:
                enabled_map = {
                    c.id: bool(c.enabled) if c.enabled is not None else False
                    for c in clients
                }

        for b in server_bindings:
            enabled = enabled_map.get(b.wg_client_id)
            result.append(
                schemas.UserServerBindingWithStatusOut(
                    id=b.id,
                    server_id=b.server_id,
                    wg_client_id=b.wg_client_id,
                    wg_client_name=b.wg_client_name,
                    expires_at=b.expires_at,
                    created_at=b.created_at,
                    enabled=enabled,
                )
            )

    return result


@app.get("/servers/{server_id}/clients/summary")
async def server_clients_summary(
    server_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    clients, error = await list_clients(db, server)
    if error or clients is None:
        raise HTTPException(status_code=400, detail=error or "Failed to list clients")

    total_rx = sum(c.transfer_rx for c in clients)
    total_tx = sum(c.transfer_tx for c in clients)
    active = sum(1 for c in clients if c.transfer_rx > 0 or c.transfer_tx > 0)
    return {
        "server_id": server.id,
        "total_clients": len(clients),
        "active_clients": active,
        "total_rx": total_rx,
        "total_tx": total_tx,
    }


@app.post("/servers/{server_id}/import-clients")
async def import_clients_from_server(
    server_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """
    Импортирует клиентов с конкретного wg-easy сервера как LogicalUser + UserServerBinding.
    - Для каждого client из /api/client:
      - если уже есть binding (server_id, wg_client_id) — пропускаем (чтобы не дублировать при повторном импорте);
      - иначе создаём нового LogicalUser с именем клиента и binding.
    """
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    clients, error = await list_clients(db, server)
    if error or clients is None:
        raise HTTPException(status_code=400, detail=error or "Failed to list clients")

    created_users = 0
    created_bindings = 0

    for c in clients:
        existing_binding = (
            db.query(UserServerBinding)
            .filter(
                UserServerBinding.server_id == server.id,
                UserServerBinding.wg_client_id == c.id,
            )
            .first()
        )
        if existing_binding:
            continue

        logical_user = LogicalUser(name=c.name)
        db.add(logical_user)
        db.flush()  # чтобы получить id без отдельного коммита
        created_users += 1

        binding = UserServerBinding(
            logical_user_id=logical_user.id,
            server_id=server.id,
            wg_client_id=c.id,
            wg_client_name=c.name,
            expires_at=c.expires_at,
        )
        db.add(binding)
        created_bindings += 1

    db.commit()

    return {
        "success": True,
        "created_users": created_users,
        "created_bindings": created_bindings,
        "total_clients_on_server": len(clients),
    }


@app.get("/dashboard/overview")
async def dashboard_overview(
    period: str = Query("24h", description="Период для графика (1h,24h,7d)"),
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    period_map = {"1h": 3600, "24h": 86400, "7d": 7 * 86400}
    period_seconds = period_map.get(period, 86400)

    servers = db.query(WgServer).order_by(WgServer.id).all()
    logical_users = {u.id: u for u in db.query(LogicalUser).all()}

    # Для подсчёта статистики по пользователям
    user_stats: Dict[int, Dict[str, object]] = {}

    result = []
    for server in servers:
        clients, error = await list_clients(db, server)
        if error or clients is None:
            result.append(
                {
                    "server_id": server.id,
                    "server_name": server.name,
                    "ok": False,
                    "error": error,
                }
            )
            continue
        total_rx = sum(c.transfer_rx for c in clients)
        total_tx = sum(c.transfer_tx for c in clients)
        active = sum(1 for c in clients if c.is_active)

        # Записываем snapshot трафика
        record_traffic_snapshot(server.id, total_rx, total_tx)
        period_rx, period_tx = get_traffic_delta_for_period(server.id, period_seconds)

        # Мапа clientId -> logical_user_id для этого сервера
        bindings = (
            db.query(UserServerBinding)
            .filter(UserServerBinding.server_id == server.id)
            .all()
        )
        client_to_user: Dict[int, int] = {
            b.wg_client_id: b.logical_user_id for b in bindings
        }

        for c in clients:
            uid = client_to_user.get(c.id)
            if not uid or uid not in logical_users:
                continue
            st = user_stats.setdefault(
                uid,
                {
                    "user_id": uid,
                    "user_name": logical_users[uid].name,
                    "peers_count": 0,
                    "active_peers": 0,
                    "servers": set(),  # type: ignore[dict-item]
                    "total_rx": 0,
                    "total_tx": 0,
                },
            )
            st["peers_count"] = int(st["peers_count"]) + 1  # type: ignore[index]
            servers_set: Set[int] = st["servers"]  # type: ignore[assignment]
            servers_set.add(server.id)
            st["total_rx"] = int(st["total_rx"]) + c.transfer_rx  # type: ignore[index]
            st["total_tx"] = int(st["total_tx"]) + c.transfer_tx  # type: ignore[index]
            if c.is_active:
                st["active_peers"] = int(st["active_peers"]) + 1  # type: ignore[index]

        result.append(
            {
                "server_id": server.id,
                "server_name": server.name,
                "ok": True,
                "total_clients": len(clients),
                "active_clients": active,
                "total_rx": total_rx,
                "total_tx": total_tx,
                "period_rx": period_rx,
                "period_tx": period_tx,
                "history": get_traffic_history(server.id, period_seconds),
            }
        )

    users_list = []
    for _, st in user_stats.items():
        servers_set: Set[int] = st["servers"]  # type: ignore[assignment]
        users_list.append(
            {
                "user_id": st["user_id"],
                "user_name": st["user_name"],
                "peers_count": st["peers_count"],
                "active_peers": st["active_peers"],
                "servers_count": len(servers_set),
                "total_rx": st["total_rx"],
                "total_tx": st["total_tx"],
            }
        )

    return {"servers": result, "users": users_list}


@app.get("/servers/{server_id}/clients/{client_id}/qrcode")
async def get_client_qrcode(
    server_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    svg_bytes, error = await fetch_qrcode_svg(db, server, client_id)
    if error or svg_bytes is None:
        raise HTTPException(status_code=400, detail=error or "Failed to fetch QR code")

    return StreamingResponse(
        iter([svg_bytes]),
        media_type="image/svg+xml",
    )


@app.post("/servers/{server_id}/clients/{client_id}/disable")
async def disable_server_client(
    server_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    error = await disable_client(db, server, client_id)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return {"success": True}


@app.post("/servers/{server_id}/clients/{client_id}/enable")
async def enable_server_client(
    server_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    error = await enable_client(db, server, client_id)
    if error:
        raise HTTPException(status_code=400, detail=error)
    return {"success": True}


@app.patch("/servers/{server_id}/clients/{client_id}/expires")
async def update_server_client_expires(
    server_id: int,
    client_id: int,
    payload: schemas.UpdateExpiresRequest,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    error = await update_client_expires(db, server, client_id, payload.expires_at)
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Обновим локальную запись binding, если есть
    binding = (
        db.query(UserServerBinding)
        .filter(
            UserServerBinding.server_id == server.id,
            UserServerBinding.wg_client_id == client_id,
        )
        .first()
    )
    if binding:
        binding.expires_at = payload.expires_at
        db.add(binding)
        db.commit()

    return {"success": True}


@app.delete("/servers/{server_id}/clients/{client_id}")
async def delete_server_client(
    server_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    error = await delete_client(db, server, client_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    # Удалим все привязки на этот clientId на этом сервере
    bindings = (
        db.query(UserServerBinding)
        .filter(
            UserServerBinding.server_id == server.id,
            UserServerBinding.wg_client_id == client_id,
        )
        .all()
    )
    for b in bindings:
        db.delete(b)
    db.commit()

    return {"success": True}


@app.delete("/users/{user_id}")
async def delete_logical_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    user = db.query(LogicalUser).filter(LogicalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Сначала пробуем удалить всех клиентов на серверах
    bindings = (
        db.query(UserServerBinding)
        .filter(UserServerBinding.logical_user_id == user_id)
        .all()
    )
    for b in bindings:
        server = db.query(WgServer).filter(WgServer.id == b.server_id).first()
        if not server:
            continue
        # Игнорируем ошибки при удалении на стороне wg-easy, чтобы не блокировать локальное удаление
        await delete_client(db, server, b.wg_client_id)

    # Теперь удаляем все привязки и самого пользователя
    for b in bindings:
        db.delete(b)
    db.delete(user)
    db.commit()

    return {"success": True}


@app.post("/users/{user_id}/servers/all")
async def attach_user_to_all_servers(
    user_id: int,
    payload: schemas.MassAttachRequest,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """
    Массовое создание peers для пользователя на всех доступных серверах.
    Пропускает сервера, где у пользователя уже есть peer.
    """
    user = db.query(LogicalUser).filter(LogicalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    servers = db.query(WgServer).all()
    if not servers:
        return {"success": True, "created": 0, "skipped": 0, "errors": []}

    created = 0
    skipped = 0
    errors: List[Dict[str, str]] = []

    for server in servers:
        # Проверяем, есть ли уже peer на этом сервере
        existing = (
            db.query(UserServerBinding)
            .filter(
                UserServerBinding.logical_user_id == user.id,
                UserServerBinding.server_id == server.id,
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        client_name = user.name
        client_id, error = await create_client(db, server, client_name, payload.expires_at)
        if error or client_id is None:
            errors.append({"server": server.name, "error": error or "Failed to create client"})
            continue

        binding = UserServerBinding(
            logical_user_id=user.id,
            server_id=server.id,
            wg_client_id=client_id,
            wg_client_name=client_name,
            expires_at=payload.expires_at,
        )
        db.add(binding)
        created += 1

    db.commit()

    return {
        "success": True,
        "created": created,
        "skipped": skipped,
        "errors": errors,
    }


@app.get("/users/{user_id}/qrcodes")
async def get_user_all_qrcodes(
    user_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """
    Возвращает список всех QR кодов для пользователя (как SVG URLs).
    """
    user = db.query(LogicalUser).filter(LogicalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    bindings = (
        db.query(UserServerBinding)
        .filter(UserServerBinding.logical_user_id == user_id)
        .all()
    )

    result = []
    for b in bindings:
        server = db.query(WgServer).filter(WgServer.id == b.server_id).first()
        if not server:
            continue
        result.append(
            {
                "server_id": server.id,
                "server_name": server.name,
                "client_id": b.wg_client_id,
                "qrcode_url": f"/servers/{server.id}/clients/{b.wg_client_id}/qrcode",
            }
        )

    return {"user_id": user.id, "user_name": user.name, "qrcodes": result}


@app.get("/servers/{server_id}/clients/{client_id}/configuration")
async def get_client_configuration(
    server_id: int,
    client_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """
    Скачивает конфигурационный файл клиента.
    """
    server = db.query(WgServer).filter(WgServer.id == server_id).first()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    # Получаем имя пользователя и сервера для имени файла
    binding = (
        db.query(UserServerBinding)
        .filter(
            UserServerBinding.server_id == server.id,
            UserServerBinding.wg_client_id == client_id,
        )
        .first()
    )

    if binding:
        user = db.query(LogicalUser).filter(LogicalUser.id == binding.logical_user_id).first()
        # Используем точно такой же формат, как в массовом скачивании
        user_name = (user.name if user else "unknown").replace(" ", "_").replace("-", "_")
        server_name = server.name.replace(" ", "_").replace("-", "_")
        filename = f"{user_name}_{server_name}.conf"
    else:
        server_name = server.name.replace(" ", "_").replace("-", "_")
        filename = f"client-{client_id}_{server_name}.conf"

    config_bytes, error = await fetch_client_configuration(db, server, client_id)
    if error or config_bytes is None:
        raise HTTPException(status_code=400, detail=error or "Failed to fetch configuration")

    # Используем точно такой же формат имени, как в массовом скачивании
    # Имя уже обработано (пробелы и дефисы заменены на подчёркивания)
    # Для HTTP заголовка проверяем, можно ли закодировать в latin-1
    try:
        filename.encode("latin-1")
        safe_filename = filename
    except UnicodeEncodeError:
        # Если есть кириллица или другие не-latin-1 символы, используем безопасное имя
        # Но стараемся сохранить структуру: user_server.conf
        if binding and user:
            safe_filename = f"user_{binding.logical_user_id}_server_{server.id}.conf"
        else:
            safe_filename = f"client-{client_id}.conf"
    
    return Response(
        content=config_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@app.get("/users/{user_id}/configurations")
async def get_user_all_configurations(
    user_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(get_current_admin),
):
    """
    Скачивает ZIP архив со всеми конфигурационными файлами пользователя.
    """
    user = db.query(LogicalUser).filter(LogicalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    bindings = (
        db.query(UserServerBinding)
        .filter(UserServerBinding.logical_user_id == user_id)
        .all()
    )

    if not bindings:
        raise HTTPException(status_code=404, detail="No peers found for this user")

    # Создаём ZIP в памяти
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for b in bindings:
            server = db.query(WgServer).filter(WgServer.id == b.server_id).first()
            if not server:
                continue

            config_bytes, error = await fetch_client_configuration(db, server, b.wg_client_id)
            if error or config_bytes is None:
                continue

            # Используем имя без проблемных символов для WireGuard
            user_name = user.name.replace(" ", "_").replace("-", "_")
            server_name = server.name.replace(" ", "_").replace("-", "_")
            filename = f"{user_name}_{server_name}.conf"
            zip_file.writestr(filename, config_bytes)

    zip_buffer.seek(0)
    # Используем имя без проблемных символов
    user_name = user.name.replace(" ", "_").replace("-", "_")
    zip_filename = f"{user_name}_configs.zip"

    # Кодируем имя файла для поддержки кириллицы в заголовке
    # Starlette требует latin-1, поэтому используем только ASCII-совместимое имя
    try:
        ascii_filename = zip_filename.encode("ascii", "ignore").decode("ascii")
        if not ascii_filename:
            ascii_filename = f"user-{user_id}_configs.zip"
    except Exception:
        ascii_filename = f"user-{user_id}_configs.zip"

    return StreamingResponse(
        iter([zip_buffer.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{ascii_filename}"'},
    )



