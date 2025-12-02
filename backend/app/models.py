from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class WgServer(Base):
    __tablename__ = "wg_servers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    base_url = Column(String(255), nullable=False)  # e.g. http://213.175.65.49:5000
    username = Column(String(255), nullable=False)
    password = Column(String(255), nullable=False)

    last_status_ok = Column(Boolean, default=False, nullable=False)
    last_checked_at = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)

    session_cookie = Column(Text, nullable=True)
    session_expires_at = Column(DateTime, nullable=True)

    bindings = relationship("UserServerBinding", back_populates="server")


class LogicalUser(Base):
    """
    Логический пользователь панели (человек), к которому могут быть привязаны
    несколько peers на разных серверах wg-easy.
    """

    __tablename__ = "logical_users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    bindings = relationship("UserServerBinding", back_populates="logical_user")


class UserServerBinding(Base):
    """
    Привязка логического пользователя к конкретному серверу wg-easy
    и конкретному clientId на этом сервере.
    """

    __tablename__ = "user_server_bindings"

    id = Column(Integer, primary_key=True, index=True)
    logical_user_id = Column(Integer, ForeignKey("logical_users.id"), nullable=False)
    server_id = Column(Integer, ForeignKey("wg_servers.id"), nullable=False)

    wg_client_id = Column(Integer, nullable=False)
    wg_client_name = Column(String(255), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    logical_user = relationship("LogicalUser", back_populates="bindings")
    server = relationship("WgServer", back_populates="bindings")


