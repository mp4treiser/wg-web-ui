import { FormEvent, useEffect, useState } from "react";
import { Server, api } from "../api";

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");

  async function loadServers() {
    setLoading(true);
    try {
      const { data } = await api.get<Server[]>("/servers");
      setServers(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadServers();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post("/servers", {
        name,
        base_url: baseUrl,
        username,
        password
      });
      setName("");
      setBaseUrl("");
      setPassword("");
      await loadServers();
    } finally {
      setCreating(false);
    }
  }

  function openEdit(server: Server) {
    setEditingServer(server);
    setEditName(server.name);
    setEditBaseUrl(server.base_url);
    setEditUsername(server.username);
    setEditPassword("");
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingServer) return;
    const payload: Partial<Server> & {
      base_url?: string;
      password?: string;
    } = {};
    if (editName !== editingServer.name) payload.name = editName;
    if (editBaseUrl !== editingServer.base_url) payload.base_url = editBaseUrl;
    if (editUsername !== editingServer.username) payload.username = editUsername;
    if (editPassword) payload.password = editPassword;
    if (Object.keys(payload).length === 0) {
      setEditingServer(null);
      return;
    }
    await api.patch(`/servers/${editingServer.id}`, payload);
    setEditingServer(null);
    await loadServers();
  }

  async function handleDelete(server: Server) {
    if (
      !window.confirm(
        "Удалить сервер и все привязанные к нему peers в панели? На самом wg-easy клиенты удалены не будут."
      )
    ) {
      return;
    }
    await api.delete(`/servers/${server.id}`);
    await loadServers();
  }

  async function handleCheck(server: Server) {
    const idx = servers.findIndex(s => s.id === server.id);
    if (idx === -1) return;
    const copy = [...servers];
    copy[idx] = { ...copy[idx], last_error: "Проверка...", last_status_ok: false };
    setServers(copy);
    try {
      const { data } = await api.post(`/servers/${server.id}/check`);
      copy[idx] = {
        ...copy[idx],
        last_status_ok: Boolean(data.ok),
        last_error: data.error ?? null,
        last_checked_at: new Date().toISOString()
      };
      setServers([...copy]);
    } catch (err) {
      copy[idx] = {
        ...copy[idx],
        last_status_ok: false,
        last_error: "Ошибка запроса"
      };
      setServers([...copy]);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Серверы</h1>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-card border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-sm text-gray-200">Список серверов</h2>
            <button
              onClick={() => void loadServers()}
              className="text-xs px-2 py-1 rounded border border-slate-700 hover:border-accent hover:text-accent transition"
            >
              Обновить
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-gray-400">Загрузка...</p>
          ) : servers.length === 0 ? (
            <p className="text-sm text-gray-400">Серверов пока нет.</p>
          ) : (
            <div className="space-y-3">
              {servers.map(s => (
                <div
                  key={s.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          s.last_status_ok ? "bg-emerald-400" : "bg-slate-600"
                        }`}
                      />
                      <span className="font-medium text-sm">{s.name}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{s.base_url}</p>
                    {s.last_error && (
                      <p className="text-xs text-red-400 mt-1 break-all">
                        Ошибка: {s.last_error}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(s)}
                      className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-accent hover:text-accent transition"
                    >
                      Редактировать
                    </button>
                    <button
                      onClick={() => void handleDelete(s)}
                      className="text-xs px-3 py-1 rounded border border-red-500/60 text-red-400 hover:bg-red-500/10 transition"
                    >
                      Удалить
                    </button>
                    <button
                      onClick={() => void handleCheck(s)}
                      className="text-xs px-3 py-1 rounded border border-slate-700 hover:border-accent hover:text-accent transition"
                    >
                      Проверить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <h2 className="font-medium text-sm text-gray-200 mb-3">Добавить сервер</h2>
          <form className="space-y-3" onSubmit={handleCreate}>
            <div>
              <label className="block text-xs mb-1">Название</label>
              <input
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs mb-1">Base URL</label>
              <input
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="http://213.175.65.49:5000"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs mb-1">Логин</label>
              <input
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs mb-1">Пароль</label>
              <input
                type="password"
                className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full mt-1 inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-sky-300 transition disabled:opacity-60"
            >
              {creating ? "Создание..." : "Создать"}
            </button>
          </form>
        </div>

        {editingServer && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
            <div className="bg-card border border-slate-700 rounded-xl p-4 w-full max-w-md relative">
              <button
                type="button"
                onClick={() => setEditingServer(null)}
                className="absolute top-2 right-2 text-xs text-gray-400 hover:text-accent"
              >
                ✕
              </button>
              <h2 className="text-sm font-semibold mb-3">
                Редактирование сервера: {editingServer.name}
              </h2>
              <form className="space-y-3" onSubmit={handleEditSubmit}>
                <div>
                  <label className="block text-xs mb-1">Название</label>
                  <input
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Base URL</label>
                  <input
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                    value={editBaseUrl}
                    onChange={e => setEditBaseUrl(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Логин</label>
                  <input
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                    value={editUsername}
                    onChange={e => setEditUsername(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">
                    Новый пароль (оставь пустым, чтобы не менять)
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full mt-1 inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-sky-300 transition"
                >
                  Сохранить
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


