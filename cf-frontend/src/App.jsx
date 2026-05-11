import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import SetupScreen from "./components/SetupScreen";
import MainApp from "./components/MainApp";
import LoginPanel from "./components/LoginPanel";
import "./index.css";

const API = "http://localhost:3001";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pendingHandle, setPendingHandle] = useState("");
  const [newUser, setNewUser] = useState("false");

  // ── Stable axios instance, password mutated in place ─────────────────────
  const passwordRef = useRef(sessionStorage.getItem("cf_pw") || "");


  const generateToken = (user) => {
    return jwt.sign(
      { handle: user.handle },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
  };

  const api = useMemo(() => axios.create({
    headers: passwordRef.current ? { "x-password": passwordRef.current } : {},
  }), []);

  const setPassword = (pw) => {
    passwordRef.current = pw;
    if (pw) {
      api.defaults.headers.common["x-password"] = pw;
      sessionStorage.setItem("cf_pw", pw);
    } else {
      delete api.defaults.headers.common["x-password"];
      sessionStorage.removeItem("cf_pw");
    }
  };

  // ── Global 401 interceptor ────────────────────────────────────────────────
  useEffect(() => {
    const id = api.interceptors.response.use(
      r => r,
      err => {
        if (err.response?.status === 401 && err.response?.data?.needsPassword) {
          setPassword("");
          setUser(null);
          setLoading(false);
        }
        return Promise.reject(err);
      }
    );
    return () => api.interceptors.response.eject(id);
  }, []);

  // ── On mount: restore session from storage ────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("cf_handle");
    const savedPw = sessionStorage.getItem("cf_pw");
    if (!saved) { setLoading(false); return; }

    if (savedPw) setPassword(savedPw); // set header before fetch

    api.get(`${API}/api/profile`, { params: { handle: saved } })
      .then(({ data }) => {
        if (data.success) {
          setUser({
            handle: data.settings.myHandle,
            practiceRating: data.settings.practiceRating,
            currentRating: data.settings.currentRating,
            friendHandles: data.settings.friendHandles || [],
          });
        } else {
          localStorage.removeItem("cf_handle");
          setPassword("");
        }
      })
      .catch(() => {
        localStorage.removeItem("cf_handle");
        setPassword("");
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleLogin = async (handle, password) => {
    setPassword(password);
    localStorage.setItem("cf_handle", handle);
    setNewUser(false);

    // Fetch full profile so TopBar has ratings + friends immediately
    try {
      const { data } = await api.get(`${API}/api/profile`, { params: { handle } });
      if (data.success) {
        setUser({
          handle: data.settings.myHandle,
          practiceRating: data.settings.practiceRating,
          currentRating: data.settings.currentRating,
          friendHandles: data.settings.friendHandles || [],
          ratingRange: data.settings.ratingRange ?? 200,
        });
      } else {
        setUser({ handle }); // fallback
      }
    } catch {
      setUser({ handle }); // fallback if profile fetch fails
    }
  };

  const handleSetUser = (u) => {
    localStorage.setItem("cf_handle", u.handle);
    setUser({
      ...u,
      ratingRange: u.ratingRange ?? 200,
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("cf_handle");
    setPassword("");
    setUser(null);
    setNeedsSetup(false);
    setPendingHandle("");
  };

  const handleNeedsSetup = (handle) => {
    setNewUser(true);
    setPendingHandle(handle);
    setNeedsSetup(true);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
    </div>
  );
  if (needsSetup) return (
    <SetupScreen
      API={API}
      api={api}
      initialHandle={pendingHandle}
      onDone={(u) => {
        setNeedsSetup(false);
        setPendingHandle("");
        handleSetUser(u);
      }}
    />
  );

  if (!user || newUser) return (
    <LoginPanel
      API={API}
      onLogin={handleLogin}
      onNeedsSetup={handleNeedsSetup}
    />
  );


  return (
    <MainApp
      API={API}
      api={api}
      user={user}
      setUser={handleSetUser}
      onLogout={handleLogout}
      onPasswordChange={(pw) => setPassword(pw)}
    />
  );
}