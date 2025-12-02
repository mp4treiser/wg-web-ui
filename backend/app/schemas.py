from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, HttpUrl


class AdminUserBase(BaseModel):
    email: EmailStr


class AdminUserCreate(AdminUserBase):
    password: str


class AdminUserOut(AdminUserBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ServerBase(BaseModel):
    name: str
    base_url: HttpUrl
    username: str
    password: str


class ServerCreate(ServerBase):
    pass


class ServerUpdate(BaseModel):
    name: Optional[str] = None
    base_url: Optional[HttpUrl] = None
    username: Optional[str] = None
    password: Optional[str] = None


class ServerOut(BaseModel):
    id: int
    name: str
    base_url: HttpUrl
    username: str
    last_status_ok: bool
    last_checked_at: Optional[datetime]
    last_error: Optional[str]

    class Config:
        from_attributes = True


class LogicalUserBase(BaseModel):
    name: str
    note: Optional[str] = None


class LogicalUserCreate(LogicalUserBase):
    pass


class LogicalUserOut(LogicalUserBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class UserServerBindingCreate(BaseModel):
    server_id: int
    expires_at: Optional[datetime]


class UserServerBindingOut(BaseModel):
    id: int
    server_id: int
    wg_client_id: int
    wg_client_name: str
    expires_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class UpdateExpiresRequest(BaseModel):
    expires_at: Optional[datetime]


class LogicalUserWithBindings(LogicalUserOut):
    bindings: List[UserServerBindingOut] = []


class UserServerBindingWithStatusOut(UserServerBindingOut):
    enabled: Optional[bool] = None


class UserServerBindingWithStatusOut(UserServerBindingOut):
    enabled: Optional[bool] = None


