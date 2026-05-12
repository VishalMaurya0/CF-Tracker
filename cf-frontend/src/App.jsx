import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import MainApp from "./components/MainApp";
import LoginPanel from "./components/LoginPanel";
import "./index.css";

const API = "https://cf-tracker-lwv5.onrender.com";
// const API = "http://localhost:3000";

const makeClient = (token) => axios.create({
    headers: token ? { Authorization: `Bearer ${token}` } : {},
});

export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const tokenRef = useRef(localStorage.getItem("cf_token") || "");

    const api = useMemo(() => makeClient(tokenRef.current), []);

    // Update token on api instance
    const setToken = (token) => {
        tokenRef.current = token;
        if (token) {
            api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
            localStorage.setItem("cf_token", token);
        } else {
            delete api.defaults.headers.common["Authorization"];
            localStorage.removeItem("cf_token");
        }
    };

    // Global 401 interceptor — token expired or invalid
    useEffect(() => {
        const id = api.interceptors.response.use(
            r => r,
            err => {
                if (err.response?.status === 401 && err.response?.data?.needsLogin) {
                    setToken("");
                    setUser(null);
                    setLoading(false);
                }
                return Promise.reject(err);
            }
        );
        return () => api.interceptors.response.eject(id);
    }, []);

    // On mount — restore session from token in localStorage
    useEffect(() => {
        const token = localStorage.getItem("cf_token");
        if (!token) { setLoading(false); return; }

        // Validate token + get fresh user data
        api.post(`${API}/api/auth/refresh`)
            .then(({ data }) => {
                if (data.success) {
                    // Issue fresh token
                    setToken(data.token);
                    setUser(data.user);
                } else {
                    setToken("");
                }
            })
            .catch(() => setToken(""))
            .finally(() => setLoading(false));
    }, []);

    const handleLogin = (userData, token) => {
        setToken(token);
        setUser(userData);
    };

    const handleSetUser = (u) => setUser(u);

    const handleLogout = () => {
        setToken("");
        setUser(null);
    };

    if (loading) return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080808" }}>
            <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
        </div>
    );

    if (!user) return (
        <LoginPanel API={API} onLogin={handleLogin} />
    );

    return (
        <MainApp
            API={API}
            api={api}
            user={user}
            setUser={handleSetUser}
            onLogout={handleLogout}
            onPasswordChange={() => { }} // handled inside settings panel if needed
        />
    );
}