import { useState } from "react";
import axios from "axios";

export default function LoginPanel({ API, onLogin, onNeedsSetup }) {
    const [handle, setHandle] = useState("");
    const [password, setPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [step, setStep] = useState("handle");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const checkHandle = async () => {
        if (!handle.trim()) return setError("Enter your CF handle.");
        setLoading(true); setError("");
        try {
            const res = await axios.post(`${API}/api/auth/login`, { handle: handle.trim() });
            if (res.data.noPasswordSet) {
                setStep("setpassword");
            } else {
                setStep("password");
            }
        } catch (e) {
            const status = e.response?.status;
            const data = e.response?.data;
            if (status === 401 && data?.needsPassword) {
                setStep("password");
            } else if (status === 404) {
                onNeedsSetup(handle.trim());
            } else {
                setError(data?.error || "Something went wrong.");
            }
        }
        setLoading(false);
    };

    const submitPassword = async () => {
        if (!password) return setError("Enter your password.");
        setLoading(true); setError("");
        try {
            await axios.post(`${API}/api/auth/login`, { handle: handle.trim(), password });
            onLogin(handle.trim(), password);
        } catch (e) {
            setError(e.response?.data?.error || "Incorrect password.");
        }
        setLoading(false);
    };

    const setFirstPassword = async () => {
        if (newPassword.length < 4) return setError("Password must be at least 4 characters.");
        if (newPassword !== confirmPassword) return setError("Passwords don't match.");
        setLoading(true); setError("");
        try {
            await axios.post(`${API}/api/auth/set-password`, {
                handle: handle.trim(),
                newPassword,
            });
            onLogin(handle.trim(), newPassword);
        } catch (e) {
            setError(e.response?.data?.error || "Failed to set password.");
        }
        setLoading(false);
    };

    const inputStyle = {
        width: "100%", padding: "10px 14px", fontSize: 14,
        background: "#111", border: "1px solid #222", borderRadius: 8,
        color: "#fff", outline: "none", boxSizing: "border-box",
    };
    const btnStyle = {
        width: "100%", padding: "11px", fontSize: 14, fontWeight: 600,
        background: "#6c47ff", color: "#fff", border: "none",
        borderRadius: 8, cursor: "pointer", marginTop: 8,
    };

    return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a" }}>
            <div style={{ width: 340, background: "#111", border: "1px solid #1a1a1a", borderRadius: 14, padding: 32 }}>
                <div style={{ fontSize: 28, textAlign: "center", marginBottom: 6 }}>⚡</div>
                <h2 style={{ textAlign: "center", fontSize: 18, fontWeight: 700, marginBottom: 4 }}>CF Tracker</h2>
                <p style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 24 }}>
                    {step === "handle" && "Enter your Codeforces handle"}
                    {step === "password" && `Welcome back, ${handle}`}
                    {step === "setpassword" && `Set a password for ${handle}`}
                </p>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {step === "handle" && (
                        <>
                            <input style={inputStyle} placeholder="CF handle e.g. tourist"
                                value={handle} onChange={e => setHandle(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && checkHandle()} autoFocus />
                            <button style={btnStyle} onClick={checkHandle} disabled={loading}>
                                {loading ? "Checking..." : "Continue →"}
                            </button>
                        </>
                    )}

                    {step === "password" && (
                        <>
                            <input style={inputStyle} type="password" placeholder="Password"
                                value={password} onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && submitPassword()} autoFocus />
                            <button style={btnStyle} onClick={submitPassword} disabled={loading}>
                                {loading ? "Verifying..." : "Log in"}
                            </button>
                            <button onClick={() => { setStep("handle"); setError(""); }}
                                style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", marginTop: 4 }}>
                                ← Back
                            </button>
                        </>
                    )}

                    {step === "setpassword" && (
                        <>
                            <p style={{ fontSize: 12, color: "#666", margin: 0 }}>
                                No password set yet. Choose one to protect your account.
                            </p>
                            <input style={inputStyle} type="password" placeholder="New password (min 4 chars)"
                                value={newPassword} onChange={e => setNewPassword(e.target.value)} autoFocus />
                            <input style={inputStyle} type="password" placeholder="Confirm password"
                                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && setFirstPassword()} />
                            <button style={btnStyle} onClick={setFirstPassword} disabled={loading}>
                                {loading ? "Saving..." : "Set password & continue"}
                            </button>
                        </>
                    )}

                    {error && (
                        <div style={{ padding: "9px 12px", background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 8, fontSize: 12, color: "#f87171" }}>
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}