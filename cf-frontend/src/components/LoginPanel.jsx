import { useState } from "react";
import axios from "axios";

export default function LoginPanel({ API, onLogin }) {
    const [handle, setHandle] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [practiceRating, setPracticeRating] = useState("");
    const [step, setStep] = useState("handle"); // "handle" | "login" | "register"
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [cfRating, setCfRating] = useState(null);

    // Step 1: check if handle exists on our DB
    const checkHandle = async () => {
        if (!handle.trim()) return setError("Enter your CF handle.");
        setLoading(true); setError("");
        try {
            const res = await axios.post(`${API}/api/auth/check`, { handle: handle.trim() });
            if (res.data.exists) {
                setStep("login");
            } else {
                // New user — fetch CF rating to pre-fill
                try {
                    const cfRes = await axios.get(`https://codeforces.com/api/user.info?handles=${handle.trim()}`);
                    const rating = cfRes.data.result[0]?.rating;
                    if (rating) setCfRating(rating);
                } catch { }
                setStep("register");
            }
        } catch (e) {
            setError(e.response?.data?.error || "Something went wrong.");
        }
        setLoading(false);
    };

    // Step 2a: existing user login
    const submitLogin = async () => {
        if (!password) return setError("Enter your password.");
        setLoading(true); setError("");
        try {
            const res = await axios.post(`${API}/api/auth/login`, { handle: handle.trim(), password });
            localStorage.setItem("cf_token", res.data.token);
            onLogin(res.data.user, res.data.token);
        } catch (e) {
            setError(e.response?.data?.error || "Incorrect password.");
        }
        setLoading(false);
    };

    // Step 2b: new user register
    const submitRegister = async () => {
        if (password.length < 4) return setError("Password must be at least 4 characters.");
        if (password !== confirmPassword) return setError("Passwords don't match.");
        setLoading(true); setError("");
        try {
            const res = await axios.post(`${API}/api/auth/register`, {
                handle: handle.trim(),
                password,
                practiceRating: practiceRating ? Number(practiceRating) : undefined,
            });
            localStorage.setItem("cf_token", res.data.token);
            onLogin(res.data.user, res.data.token);
        } catch (e) {
            setError(e.response?.data?.error || "Registration failed.");
        }
        setLoading(false);
    };

    const inputStyle = {
        width: "100%", padding: "10px 14px", fontSize: 14,
        background: "#0d0d0d", border: "1px solid #1e1e1e", borderRadius: 8,
        color: "#fff", outline: "none", boxSizing: "border-box",
        transition: "border-color .2s",
    };
    const btnStyle = {
        width: "100%", padding: "12px", fontSize: 14, fontWeight: 600,
        background: "#6c47ff", color: "#fff", border: "none",
        borderRadius: 8, cursor: "pointer", marginTop: 4,
        transition: "opacity .2s",
    };

    return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080808" }}>
            <div style={{ width: 360, background: "#111", border: "1px solid #1a1a1a", borderRadius: 16, padding: "36px 32px", boxShadow: "0 24px 80px #000a" }}>
                <div style={{ fontSize: 32, textAlign: "center", marginBottom: 8 }}>⚡</div>
                <h2 style={{ textAlign: "center", fontSize: 20, fontWeight: 700, marginBottom: 4, color: "#fff" }}>CF Tracker</h2>
                <p style={{ textAlign: "center", fontSize: 12, color: "#444", marginBottom: 28 }}>
                    {step === "handle" && "Enter your Codeforces handle to continue"}
                    {step === "login" && `Welcome back, ${handle}`}
                    {step === "register" && `Create your account, ${handle}`}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {/* Handle input — always shown, locked after step 1 */}
                    <div style={{ position: "relative" }}>
                        <input
                            style={{ ...inputStyle, paddingRight: step !== "handle" ? 64 : 14, color: step !== "handle" ? "#666" : "#fff" }}
                            placeholder="CF handle e.g. tourist"
                            value={handle}
                            onChange={e => { if (step === "handle") setHandle(e.target.value); }}
                            onKeyDown={e => step === "handle" && e.key === "Enter" && checkHandle()}
                            readOnly={step !== "handle"}
                            autoFocus={step === "handle"}
                        />
                        {step !== "handle" && (
                            <button onClick={() => { setStep("handle"); setError(""); setPassword(""); setConfirmPassword(""); }}
                                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 11, padding: "2px 6px" }}>
                                change
                            </button>
                        )}
                    </div>

                    {step === "handle" && (
                        <button style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }} onClick={checkHandle} disabled={loading}>
                            {loading ? "Checking..." : "Continue →"}
                        </button>
                    )}

                    {step === "login" && (
                        <>
                            <input style={inputStyle} type="password" placeholder="Password"
                                value={password} onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && submitLogin()} autoFocus />
                            <button style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }} onClick={submitLogin} disabled={loading}>
                                {loading ? "Logging in..." : "Log in →"}
                            </button>
                        </>
                    )}

                    {step === "register" && (
                        <>
                            <div style={{ fontSize: 11, color: "#555", padding: "6px 10px", background: "#0d0d0d", borderRadius: 6, border: "1px solid #1a1a1a" }}>
                                {cfRating
                                    ? `CF rating: ${cfRating} — set a practice rating below or leave to use this`
                                    : "New account — set a password to get started"}
                            </div>
                            <input style={inputStyle} type="number" placeholder={cfRating ? `Practice rating (default: ${cfRating})` : "Practice rating (default: 1200)"}
                                value={practiceRating} onChange={e => setPracticeRating(e.target.value)} />
                            <input style={inputStyle} type="password" placeholder="Choose a password (min 4 chars)"
                                value={password} onChange={e => setPassword(e.target.value)} autoFocus />
                            <input style={inputStyle} type="password" placeholder="Confirm password"
                                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && submitRegister()} />
                            <button style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }} onClick={submitRegister} disabled={loading}>
                                {loading ? "Creating account..." : "Create account →"}
                            </button>
                        </>
                    )}

                    {error && (
                        <div style={{ padding: "9px 12px", background: "#1a0808", border: "1px solid #3a1010", borderRadius: 8, fontSize: 12, color: "#f87171" }}>
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}