import { useEffect, useMemo, useState } from "react";
import { Server, api } from "../api";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend
} from "recharts";

interface OverviewItem {
  server_id: number;
  server_name: string;
  ok: boolean;
  total_clients?: number;
  active_clients?: number;
  total_rx?: number;
  total_tx?: number;
  error?: string;
  period_rx?: number;
  period_tx?: number;
  history?: Array<{
    timestamp: string;
    total_rx: number;
    total_tx: number;
  }>;
}

interface OverviewResponse {
  servers: OverviewItem[];
  users?: UserOverviewItem[];
}

interface UserOverviewItem {
  user_id: number;
  user_name: string;
  peers_count: number;
  active_peers?: number;
  servers_count: number;
  total_rx: number;
  total_tx: number;
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [users, setUsers] = useState<UserOverviewItem[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"1h" | "24h" | "7d">("24h");
  const [hiddenServerIds, setHiddenServerIds] = useState<number[]>([]);
  const [metric, setMetric] = useState<"rx" | "tx">("rx");

  async function loadData() {
    setLoading(true);
    try {
      const [ovRes, srvRes] = await Promise.all([
        api.get<OverviewResponse>("/dashboard/overview", {
          params: { period }
        }),
        api.get<Server[]>("/servers")
      ]);
      setOverview(ovRes.data.servers);
      setUsers(ovRes.data.users || []);
      setServers(srvRes.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [period]);

  const chartData = useMemo(() => {
    const historyMap = new Map<
      string,
      {
        timestamp: string;
        [key: string]: number | string;
      }
    >();

    overview.forEach(o => {
      if (!o.history || hiddenServerIds.includes(o.server_id)) return;
      o.history.forEach(point => {
        const key = point.timestamp;
        if (!historyMap.has(key)) {
          historyMap.set(key, { timestamp: key });
        }
        const value =
          metric === "rx"
            ? point.total_rx / (1024 * 1024)
            : point.total_tx / (1024 * 1024);
        historyMap.get(key)![o.server_name] = Number(value.toFixed(2));
      });
    });

    return Array.from(historyMap.values()).sort(
      (a, b) =>
        new Date(a.timestamp as string).getTime() -
        new Date(b.timestamp as string).getTime()
    );
  }, [overview, hiddenServerIds, metric]);

  const colorPalette = [
    "#38bdf8",
    "#22c55e",
    "#f97316",
    "#a855f7",
    "#f43f5e",
    "#14b8a6",
    "#facc15",
    "#ef4444",
    "#8b5cf6",
    "#0ea5e9"
  ];

  const serverColorMap = useMemo(() => {
    const map = new Map<number, string>();
    overview.forEach((o, idx) => {
      map.set(o.server_id, colorPalette[idx % colorPalette.length]);
    });
    return map;
  }, [overview]);

  const totalClients = overview.reduce((acc, o) => acc + (o.total_clients ?? 0), 0);
  const activeClients = overview.reduce((acc, o) => acc + (o.active_clients ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-gray-400">
            Сводка по всем wg-easy серверам и пользователям.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span>Период:</span>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as "1h" | "24h" | "7d")}
              className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="1h">1 час</option>
              <option value="24h">24 часа</option>
              <option value="7d">7 дней</option>
            </select>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span>Метрика:</span>
            <div className="flex items-center border border-slate-700 rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setMetric("rx")}
                className={`px-2 py-1 ${
                  metric === "rx" ? "bg-accent text-slate-900" : "text-gray-300"
                }`}
              >
                RX
              </button>
              <button
                type="button"
                onClick={() => setMetric("tx")}
                className={`px-2 py-1 ${
                  metric === "tx" ? "bg-accent text-slate-900" : "text-gray-300"
                }`}
              >
                TX
              </button>
            </div>
          </div>
          <button
            onClick={() => void loadData()}
            className="text-xs px-3 py-1.5 rounded border border-slate-700 hover:border-accent hover:text-accent transition"
          >
            Обновить
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Загрузка...</p>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Серверов</p>
              <p className="text-2xl font-semibold">{servers.length}</p>
              <p className="text-xs text-gray-500 mt-2">
                {overview.filter(o => o.ok).length} онлайн /{" "}
                {overview.filter(o => !o.ok).length} оффлайн
              </p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Peers всего</p>
              <p className="text-2xl font-semibold">{totalClients}</p>
              <p className="text-xs text-gray-500 mt-2">
                Активных: <span className="text-emerald-400">{activeClients}</span>
              </p>
            </div>
            <div className="bg-card border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">Состояние</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-sm text-gray-200">
                  Панель подключена к {overview.filter(o => o.ok).length} серверам
                </span>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 bg-card border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium text-sm text-gray-200">
                  Трафик по серверам (MB, {metric.toUpperCase()}) за период
                </h2>
              </div>
              {chartData.length === 0 ? (
                <p className="text-sm text-gray-400">
                  Нет данных о трафике. Убедитесь, что сервера доступны.
                </p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <XAxis
                        dataKey="timestamp"
                        stroke="#64748b"
                        fontSize={11}
                        tickFormatter={value =>
                          new Date(value).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit"
                          })
                        }
                      />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          background: "#020617",
                          border: "1px solid #1e293b",
                          borderRadius: "0.5rem",
                          fontSize: 12
                        }}
                        labelFormatter={value =>
                          new Date(value).toLocaleString(undefined, {
                            dateStyle: "short",
                            timeStyle: "short"
                          })
                        }
                      />
                      <Legend />
                      {overview
                        .filter(
                          o => o.ok && !hiddenServerIds.includes(o.server_id)
                        )
                        .map(o => (
                          <Line
                            key={o.server_id}
                            type="monotone"
                            dataKey={o.server_name}
                            stroke={serverColorMap.get(o.server_id) ?? "#38bdf8"}
                            dot={false}
                            strokeWidth={2}
                            isAnimationActive={false}
                          />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="bg-card border border-slate-800 rounded-xl p-4 space-y-3">
              <h2 className="font-medium text-sm text-gray-200">
                Состояние серверов
              </h2>
              {overview.length === 0 ? (
                <p className="text-sm text-gray-400">Серверов пока нет.</p>
              ) : (
                <div className="space-y-2">
                  {overview.map(o => {
                    const color = serverColorMap.get(o.server_id) ?? "#38bdf8";
                    return (
                      <div
                        key={o.server_id}
                        className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="text-sm">{o.server_name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setHiddenServerIds(prev =>
                                prev.includes(o.server_id)
                                  ? prev.filter(id => id !== o.server_id)
                                  : [...prev, o.server_id]
                              )
                            }
                            className="text-[11px] px-2 py-0.5 rounded border border-slate-700 text-gray-300 hover:border-accent hover:text-accent transition"
                          >
                            {hiddenServerIds.includes(o.server_id)
                              ? "Показать"
                              : "Скрыть"}
                          </button>
                        </div>
                        {o.ok ? (
                          <p className="text-xs text-gray-400">
                            Peers: {o.total_clients} / Активных:{" "}
                            <span className="text-emerald-400">
                              {o.active_clients}
                            </span>
                            {" · Трафик (период): "}
                            <span className="text-sky-300">
                              RX {Math.round((o.period_rx ?? 0) / (1024 * 1024))}
                              MB
                            </span>
                            {" / "}
                            <span className="text-sky-300">
                              TX {Math.round((o.period_tx ?? 0) / (1024 * 1024))}
                              MB
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-red-400">
                            Ошибка подключения: {o.error ?? "неизвестно"}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-3 bg-card border border-slate-800 rounded-xl p-4 space-y-3">
            <h2 className="font-medium text-sm text-gray-200">
              Статистика по пользователям
            </h2>
            {users.length === 0 ? (
              <p className="text-sm text-gray-400">
                Пока нет пользователей с привязанными peers.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-slate-700">
                      <th className="py-2 pr-4">Пользователь</th>
                      <th className="py-2 pr-4">Peers</th>
                      <th className="py-2 pr-4">Активных</th>
                      <th className="py-2 pr-4">Серверов</th>
                      <th className="py-2 pr-4">Трафик RX (MB)</th>
                      <th className="py-2 pr-4">Трафик TX (MB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.user_id} className="border-b border-slate-800/60">
                        <td className="py-2 pr-4 text-gray-200">{u.user_name}</td>
                        <td className="py-2 pr-4 text-gray-300">{u.peers_count}</td>
                        <td className="py-2 pr-4 text-emerald-300">
                          {u.active_peers ?? 0}
                        </td>
                        <td className="py-2 pr-4 text-gray-300">{u.servers_count}</td>
                        <td className="py-2 pr-4 text-emerald-300">
                          {Math.round(u.total_rx / (1024 * 1024))}
                        </td>
                        <td className="py-2 pr-4 text-sky-300">
                          {Math.round(u.total_tx / (1024 * 1024))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}


