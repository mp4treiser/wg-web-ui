import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./api";
import DashboardPage from "./pages/DashboardPage";
import ServersPage from "./pages/ServersPage";
import UsersPage from "./pages/UsersPage";
import LoginPage from "./pages/LoginPage";

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();

  const [meLoaded, setMeLoaded] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    api
      .get("/me")
      .then(() => {
        setIsAuthed(true);
      })
      .catch(() => {
        setIsAuthed(false);
      })
      .finally(() => setMeLoaded(true));
  }, []);

  if (!meLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="text-gray-400">Загрузка...</span>
      </div>
    );
  }

  if (!isAuthed && location.pathname !== "/login") {
    return <Navigate to="/login" replace />;
  }

  if (!isAuthed) {
    return <LoginPage onLoggedIn={() => navigate("/")} />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-card/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold tracking-tight">WG Easy Admin Panel</span>
          </div>
          <nav className="flex gap-4 text-sm">
            <button
              onClick={() => navigate("/")}
              className={`hover:text-accent transition ${
                location.pathname === "/" ? "text-accent font-semibold" : "text-gray-300"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => navigate("/servers")}
              className={`hover:text-accent transition ${
                location.pathname.startsWith("/servers")
                  ? "text-accent font-semibold"
                  : "text-gray-300"
              }`}
            >
              Servers
            </button>
            <button
              onClick={() => navigate("/users")}
              className={`hover:text-accent transition ${
                location.pathname.startsWith("/users")
                  ? "text-accent font-semibold"
                  : "text-gray-300"
              }`}
            >
              Users
            </button>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-6xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/users" element={<UsersPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  );
}


