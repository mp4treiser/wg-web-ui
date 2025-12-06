import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  API_BASE_URL,
  LogicalUser,
  Server,
  UserServerBinding,
  api
} from "../api";

export default function UsersPage() {
  const [users, setUsers] = useState<LogicalUser[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [bindings, setBindings] = useState<UserServerBinding[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingBindings, setLoadingBindings] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [creatingBinding, setCreatingBinding] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserNote, setNewUserNote] = useState("");
  const [bindServerId, setBindServerId] = useState<number | "">("");
  const [bindExpiry, setBindExpiry] = useState("");
  const [importServerId, setImportServerId] = useState<number | "">("");
  const [importing, setImporting] = useState(false);
  const [qrBinding, setQrBinding] = useState<UserServerBinding | null>(null);
  const [updatingExpiryId, setUpdatingExpiryId] = useState<number | null>(null);
  const [updatingExpiryValue, setUpdatingExpiryValue] = useState("");
  const [busyClientId, setBusyClientId] = useState<number | null>(null);
  const [massCreating, setMassCreating] = useState(false);
  const [allQrCodes, setAllQrCodes] = useState<Array<{
    server_id: number;
    server_name: string;
    client_id: number;
    qrcode_url: string;
  }> | null>(null);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const { data } = await api.get<LogicalUser[]>("/users");
      setUsers(data);
      if (data.length > 0 && !selectedUserId) {
        setSelectedUserId(data[0].id);
      }
    } finally {
      setLoadingUsers(false);
    }
  }

  async function loadServers() {
    const { data } = await api.get<Server[]>("/servers");
    setServers(data);
  }

  async function loadBindings(userId: number) {
    setLoadingBindings(true);
    try {
      const { data } = await api.get<UserServerBinding[]>(
        `/users/${userId}/servers/status`
      );
      setBindings(data);
    } finally {
      setLoadingBindings(false);
    }
  }

  useEffect(() => {
    void loadUsers();
    void loadServers();
  }, []);

  useEffect(() => {
    if (selectedUserId != null) {
      void loadBindings(selectedUserId);
    } else {
      setBindings([]);
    }
  }, [selectedUserId]);

  async function handleCreateUser(e: FormEvent) {
    e.preventDefault();
    setCreatingUser(true);
    try {
      await api.post("/users", { name: newUserName, note: newUserNote || null });
      setNewUserName("");
      setNewUserNote("");
      await loadUsers();
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleCreateBinding(e: FormEvent) {
    e.preventDefault();
    if (!selectedUserId || !bindServerId) return;
    setCreatingBinding(true);
    try {
      await api.post(`/users/${selectedUserId}/servers`, {
        server_id: bindServerId,
        expires_at: bindExpiry ? new Date(bindExpiry).toISOString() : null
      });
      setBindExpiry("");
      setBindServerId("");
      await loadBindings(selectedUserId);
    } finally {
      setCreatingBinding(false);
    }
  }

  async function handleImportFromServer(e: FormEvent) {
    e.preventDefault();
    if (!importServerId) return;
    setImporting(true);
    try {
      await api.post(`/servers/${importServerId}/import-clients`);
      await loadUsers();
      if (selectedUserId) {
        await loadBindings(selectedUserId);
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleDisable(binding: UserServerBinding) {
    setBusyClientId(binding.wg_client_id);
    try {
      await api.post(
        `/servers/${binding.server_id}/clients/${binding.wg_client_id}/disable`
      );
      if (selectedUserId) {
        await loadBindings(selectedUserId);
      }
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleEnable(binding: UserServerBinding) {
    setBusyClientId(binding.wg_client_id);
    try {
      await api.post(
        `/servers/${binding.server_id}/clients/${binding.wg_client_id}/enable`
      );
      if (selectedUserId) {
        await loadBindings(selectedUserId);
      }
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleDisableAllForUser() {
    if (!selectedUserId) return;
    if (
      !window.confirm(
        "Отключить все peers этого пользователя на всех серверах? Это можно будет включить обратно."
      )
    ) {
      return;
    }
    setBusyClientId(-1);
    try {
      const currentBindings = await api.get<UserServerBinding[]>(
        `/users/${selectedUserId}/servers/status`
      );
      await Promise.all(
        currentBindings.data.map(b =>
          api.post(`/servers/${b.server_id}/clients/${b.wg_client_id}/disable`)
        )
      );
      await loadBindings(selectedUserId);
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleEnableAllForUser() {
    if (!selectedUserId) return;
    if (
      !window.confirm(
        "Включить все peers этого пользователя на всех серверах?"
      )
    ) {
      return;
    }
    setBusyClientId(-1);
    try {
      const currentBindings = await api.get<UserServerBinding[]>(
        `/users/${selectedUserId}/servers/status`
      );
      await Promise.all(
        currentBindings.data.map(b =>
          api.post(`/servers/${b.server_id}/clients/${b.wg_client_id}/enable`)
        )
      );
      await loadBindings(selectedUserId);
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleDeleteBinding(binding: UserServerBinding) {
    if (
      !window.confirm(
        "Удалить этого peer'а на сервере (и привязку в панели)? Это действие необратимо."
      )
    ) {
      return;
    }
    setBusyClientId(binding.wg_client_id);
    try {
      await api.delete(`/servers/${binding.server_id}/clients/${binding.wg_client_id}`);
      if (selectedUserId) {
        await loadBindings(selectedUserId);
      }
    } finally {
      setBusyClientId(null);
    }
  }

  function startEditExpiry(binding: UserServerBinding) {
    setUpdatingExpiryId(binding.id);
    setUpdatingExpiryValue(
      binding.expires_at ? binding.expires_at.slice(0, 10) : ""
    );
  }

  async function saveEditExpiry(binding: UserServerBinding) {
    setBusyClientId(binding.wg_client_id);
    try {
      await api.patch(
        `/servers/${binding.server_id}/clients/${binding.wg_client_id}/expires`,
        {
          expires_at: updatingExpiryValue
            ? new Date(updatingExpiryValue).toISOString()
            : null
        }
      );
      setUpdatingExpiryId(null);
      setUpdatingExpiryValue("");
      if (selectedUserId) {
        await loadBindings(selectedUserId);
      }
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleDeleteUser() {
    if (!selectedUser) return;
    if (
      !window.confirm(
        "Удалить пользователя и все его peers на серверах? Это действие необратимо."
      )
    ) {
      return;
    }
    await api.delete(`/users/${selectedUser.id}`);
    setSelectedUserId(null);
    setBindings([]);
    await loadUsers();
  }

  async function handleMassCreateBindings(e: FormEvent) {
    e.preventDefault();
    if (!selectedUserId) return;
    setMassCreating(true);
    try {
      const result = await api.post(`/users/${selectedUserId}/servers/all`, {
        expires_at: bindExpiry ? new Date(bindExpiry).toISOString() : null
      });
      setBindExpiry("");
      await loadBindings(selectedUserId);
      if (result.data.created > 0 || result.data.skipped > 0) {
        alert(
          `Создано peers: ${result.data.created}, пропущено (уже есть): ${result.data.skipped}${
            result.data.errors.length > 0
              ? `, ошибок: ${result.data.errors.length}`
              : ""
          }`
        );
      }
    } finally {
      setMassCreating(false);
    }
  }

  async function handleShowAllQRCodes() {
    if (!selectedUserId) return;
    try {
      const { data } = await api.get(`/users/${selectedUserId}/qrcodes`);
      setAllQrCodes(data.qrcodes);
    } catch (err) {
      alert("Ошибка при загрузке QR кодов");
    }
  }

  async function handleDownloadConfig(binding: UserServerBinding) {
    try {
      const response = await api.get(
        `/servers/${binding.server_id}/clients/${binding.wg_client_id}/configuration`,
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const server = servers.find(s => s.id === binding.server_id);
      const user = selectedUser;
      // Используем тот же формат, что и в массовом скачивании (с подчёркиваниями)
      const userName = (user?.name || "unknown").replace(/[\s-]/g, "_");
      const serverName = (server?.name || `server-${binding.server_id}`).replace(/[\s-]/g, "_");
      link.setAttribute("download", `${userName}_${serverName}.conf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Ошибка при скачивании конфига");
    }
  }

  async function handleDownloadAllConfigs() {
    if (!selectedUserId) return;
    try {
      const response = await api.get(`/users/${selectedUserId}/configurations`, {
        responseType: "blob"
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      const user = selectedUser;
      link.setAttribute("download", `${user?.name || "user"}_configs.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Ошибка при скачивании конфигов");
    }
  }

  const selectedUser = useMemo(
    () => users.find(u => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Пользователи (peers)</h1>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-card border border-slate-800 rounded-xl p-4 max-h-[520px] overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-sm text-gray-200">Список пользователей</h2>
            <button
              onClick={() => void loadUsers()}
              className="text-xs px-2 py-1 rounded border border-slate-700 hover:border-accent hover:text-accent transition"
            >
              Обновить
            </button>
          </div>
          {loadingUsers ? (
            <p className="text-sm text-gray-400">Загрузка...</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-400">Пользователей пока нет.</p>
          ) : (
            <div className="space-y-1">
              {users.map(u => (
                <button
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm border ${
                    selectedUserId === u.id
                      ? "border-accent bg-slate-900"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{u.name}</span>
                    <span className="text-[10px] text-gray-500">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {u.note && (
                    <p className="mt-0.5 text-xs text-gray-400 line-clamp-2">{u.note}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-slate-800 rounded-xl p-4 md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium text-sm text-gray-200">
                {selectedUser ? `Пользователь: ${selectedUser.name}` : "Выберите пользователя"}
              </h2>
              {selectedUser?.note && (
                <p className="text-xs text-gray-400 mt-0.5">{selectedUser.note}</p>
              )}
            </div>
            {selectedUser && (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => void handleDisableAllForUser()}
                  className="text-xs px-3 py-1 rounded border border-slate-700 text-yellow-300 hover:border-yellow-400 hover:text-yellow-400 transition"
                >
                  Откл. все peers
                </button>
                <button
                  type="button"
                  onClick={() => void handleEnableAllForUser()}
                  className="text-xs px-3 py-1 rounded border border-slate-700 text-emerald-300 hover:border-emerald-400 hover:text-emerald-400 transition"
                >
                  Вкл. все peers
                </button>
                <button
                  type="button"
                  onClick={() => void handleShowAllQRCodes()}
                  className="text-xs px-3 py-1 rounded border border-slate-700 text-sky-300 hover:border-sky-400 hover:text-sky-400 transition"
                >
                  Все QR коды
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadAllConfigs()}
                  className="text-xs px-3 py-1 rounded border border-slate-700 text-purple-300 hover:border-purple-400 hover:text-purple-400 transition"
                >
                  Скачать все конфиги
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteUser()}
                  className="text-xs px-3 py-1 rounded border border-red-500/60 text-red-400 hover:bg-red-500/10 transition"
                >
                  Удалить пользователя
                </button>
              </div>
            )}
          </div>

          {selectedUser && (
            <>
              <div>
                <h3 className="text-xs font-semibold text-gray-300 mb-2">
                  Привязанные серверы / peers
                </h3>
                {loadingBindings ? (
                  <p className="text-sm text-gray-400">Загрузка привязок...</p>
                ) : bindings.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    Для этого пользователя пока нет ни одного peer.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bindings.map(b => {
                      const server = servers.find(s => s.id === b.server_id);
                      return (
                        <div
                          key={b.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">
                                {server?.name ?? `Server #${b.server_id}`}
                              </span>
                              <span className="text-[10px] text-gray-500">
                                clientId: {b.wg_client_id}
                              </span>
                            </div>
                            <p className="text-xs text-gray-300">
                              Создан:{" "}
                              {new Date(b.created_at).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short"
                              })}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-xs text-gray-300">Истекает:</span>
                              {updatingExpiryId === b.id ? (
                                <>
                                  <input
                                    type="date"
                                    className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-accent"
                                    value={updatingExpiryValue}
                                    onChange={e => setUpdatingExpiryValue(e.target.value)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void saveEditExpiry(b)}
                                    className="text-[11px] px-2 py-1 rounded bg-accent text-slate-900 hover:bg-sky-300 transition"
                                  >
                                    Сохранить
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setUpdatingExpiryId(null);
                                      setUpdatingExpiryValue("");
                                    }}
                                    className="text-[11px] px-2 py-1 rounded border border-slate-600 text-gray-300 hover:border-accent hover:text-accent transition"
                                  >
                                    Отмена
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span className="text-xs text-gray-300">
                                    {b.expires_at
                                      ? new Date(b.expires_at).toLocaleDateString()
                                      : "без срока"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => startEditExpiry(b)}
                                    className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-gray-300 hover:border-accent hover:text-accent transition"
                                  >
                                    Изменить
                                  </button>
                                </>
                              )}
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-xs text-gray-300">Статус:</span>
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
                                  b.enabled === true
                                    ? "bg-emerald-500/10 text-emerald-300"
                                    : b.enabled === false
                                    ? "bg-slate-700/60 text-slate-200"
                                    : "bg-slate-800/70 text-slate-300"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    b.enabled === true
                                      ? "bg-emerald-400"
                                      : b.enabled === false
                                      ? "bg-slate-400"
                                      : "bg-slate-500"
                                  }`}
                                />
                                {b.enabled === true
                                  ? "включен"
                                  : b.enabled === false
                                  ? "выключен"
                                  : "неизвестно"}
                              </span>
                            </div>
                          </div>
                          {server && (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() => setQrBinding(b)}
                                  className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-accent hover:text-accent transition text-center"
                                >
                                  QR код
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDownloadConfig(b)}
                                  className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-purple-400 hover:text-purple-300 transition text-center"
                                >
                                  Скачать конфиг
                                </button>
                              </div>
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  disabled={busyClientId === b.wg_client_id}
                                  onClick={() => void handleDisable(b)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-yellow-300 hover:border-yellow-400 hover:text-yellow-400 disabled:opacity-60"
                                >
                                  Откл.
                                </button>
                                <button
                                  type="button"
                                  disabled={busyClientId === b.wg_client_id}
                                  onClick={() => void handleEnable(b)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-emerald-300 hover:border-emerald-400 hover:text-emerald-400 disabled:opacity-60"
                                >
                                  Вкл.
                                </button>
                                <button
                                  type="button"
                                  disabled={busyClientId === b.wg_client_id}
                                  onClick={() => void handleDeleteBinding(b)}
                                  className="text-[11px] px-2 py-0.5 rounded border border-red-500/60 text-red-400 hover:bg-red-500/10 disabled:opacity-60"
                                >
                                  Удалить
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-800 pt-3 space-y-3">
                <div>
                  <h3 className="text-xs font-semibold text-gray-300 mb-2">
                    Добавить peer на сервер
                  </h3>
                  <form
                    className="grid md:grid-cols-3 gap-3 items-end"
                    onSubmit={handleCreateBinding}
                  >
                    <div>
                      <label className="block text-xs mb-1">Сервер</label>
                      <select
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                        value={bindServerId}
                        onChange={e =>
                          setBindServerId(e.target.value ? Number(e.target.value) : "")
                        }
                        required
                      >
                        <option value="">Выберите сервер</option>
                        {servers.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs mb-1">Срок действия (опционально)</label>
                      <input
                        type="date"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                        value={bindExpiry}
                        onChange={e => setBindExpiry(e.target.value)}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={creatingBinding}
                      className="mt-1 inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-sky-300 transition disabled:opacity-60"
                    >
                      {creatingBinding ? "Создание..." : "Создать peer"}
                    </button>
                  </form>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-300 mb-2">
                    Массовое добавление на все серверы
                  </h3>
                  <form
                    className="grid md:grid-cols-2 gap-3 items-end"
                    onSubmit={handleMassCreateBindings}
                  >
                    <div>
                      <label className="block text-xs mb-1">Срок действия (опционально)</label>
                      <input
                        type="date"
                        className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                        value={bindExpiry}
                        onChange={e => setBindExpiry(e.target.value)}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={massCreating}
                      className="mt-1 inline-flex items-center justify-center rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-100 border border-slate-700 hover:border-accent hover:text-accent transition disabled:opacity-60"
                    >
                      {massCreating ? "Создание..." : "Создать peers на всех серверах"}
                    </button>
                  </form>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <div className="space-y-5">
            <div>
              <h2 className="font-medium text-sm text-gray-200 mb-3">
                Создать пользователя
              </h2>
              <form className="space-y-3" onSubmit={handleCreateUser}>
                <div>
                  <label className="block text-xs mb-1">Имя</label>
                  <input
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                    value={newUserName}
                    onChange={e => setNewUserName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Комментарий (опционально)</label>
                  <textarea
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                    rows={3}
                    value={newUserNote}
                    onChange={e => setNewUserNote(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="w-full mt-1 inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-sky-300 transition disabled:opacity-60"
                >
                  {creatingUser ? "Создание..." : "Создать"}
                </button>
              </form>
            </div>

            <div className="border-t border-slate-800 pt-4">
              <h2 className="font-medium text-sm text-gray-200 mb-2">
                Импортировать пользователей с сервера
              </h2>
              <p className="text-xs text-gray-400 mb-2">
                Создаст логических пользователей и привязки для всех клиентов, найденных в
                wg-easy. Повторный импорт не будет дублировать уже импортированных клиентов.
              </p>
              <form className="space-y-3" onSubmit={handleImportFromServer}>
                <div>
                  <label className="block text-xs mb-1">Сервер</label>
                  <select
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                    value={importServerId}
                    onChange={e =>
                      setImportServerId(e.target.value ? Number(e.target.value) : "")
                    }
                    required
                  >
                    <option value="">Выберите сервер</option>
                    {servers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={importing}
                  className="w-full inline-flex items-center justify-center rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-100 border border-slate-700 hover:border-accent hover:text-accent transition disabled:opacity-60"
                >
                  {importing ? "Импорт..." : "Импортировать"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {qrBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-slate-700 rounded-xl p-4 w-full max-w-sm relative">
            <button
              type="button"
              onClick={() => setQrBinding(null)}
              className="absolute top-2 right-2 text-xs text-gray-400 hover:text-accent"
            >
              ✕
            </button>
            <h2 className="text-sm font-semibold mb-3">
              QR код — clientId {qrBinding.wg_client_id}
            </h2>
            <div className="bg-white rounded-md p-2 flex items-center justify-center">
              <img
                src={`${API_BASE_URL}/servers/${qrBinding.server_id}/clients/${qrBinding.wg_client_id}/qrcode`}
                alt="WireGuard QR"
                className="max-w-full h-auto"
              />
            </div>
            <p className="mt-3 text-[11px] text-gray-400">
              Наведи камеру WireGuard-клиента на QR-код. Окно можно закрыть крестиком.
            </p>
          </div>
        </div>
      )}

      {allQrCodes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 overflow-y-auto p-4">
          <div className="bg-card border border-slate-700 rounded-xl p-4 w-full max-w-4xl relative max-h-[90vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setAllQrCodes(null)}
              className="absolute top-2 right-2 text-xs text-gray-400 hover:text-accent"
            >
              ✕
            </button>
            <h2 className="text-sm font-semibold mb-4">Все QR коды пользователя</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allQrCodes.map(qr => (
                <div key={`${qr.server_id}-${qr.client_id}`} className="bg-slate-900 rounded-lg p-3">
                  <p className="text-xs text-gray-300 mb-2">
                    {qr.server_name} (clientId: {qr.client_id})
                  </p>
                  <div className="bg-white rounded-md p-2 flex items-center justify-center">
                    <img
                      src={`${API_BASE_URL}${qr.qrcode_url}`}
                      alt={`QR ${qr.server_name}`}
                      className="max-w-full h-auto"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


