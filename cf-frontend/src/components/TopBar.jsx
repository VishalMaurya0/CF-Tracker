import { useState } from "react";

const syncSettings = (api, API, friendHandles, practiceRating, ratingRange) => {
    api.post(`${API}/api/setup`, { friendHandles, practiceRating, ratingRange })
        .then(() => console.log("✅ settings synced"))
        .catch(err => console.error("❌ sync failed:", err.response?.data || err.message));
};

export default function TopBar({ user, setUser, API, api, section, setSection, analysisReady, onLogout }) {
    const [friendInput, setFriendInput] = useState("");
    const [friends, setFriends] = useState(user.friendHandles || []);
    const [showFriends, setShowFriends] = useState(false);
    const [friendErr, setFriendErr] = useState("");
    const [editingRating, setEditingRating] = useState(false);
    const [ratingDraft, setRatingDraft] = useState(user.practiceRating || "");
    const [rangeDraft, setRangeDraft] = useState(user.ratingRange ?? 200);
    const [ratingErr, setRatingErr] = useState("");

    const openRatingEdit = () => { setRatingDraft(user.practiceRating || ""); setRangeDraft(user.ratingRange ?? 200); setRatingErr(""); setEditingRating(true); setShowFriends(false); };
    const cancelRating = () => { setRatingDraft(user.practiceRating || ""); setRangeDraft(user.ratingRange ?? 200); setRatingErr(""); setEditingRating(false); };

    const saveRating = () => {
        const pr = Number(ratingDraft), rng = Number(rangeDraft);
        if (!pr || pr < 800 || pr > 3500) { setRatingErr("Rating must be 800–3500."); return; }
        if (!rng || rng < 50 || rng > 1000) { setRatingErr("Range must be 50–1000."); return; }
        setRatingErr(""); setEditingRating(false);
        const updated = { ...user, practiceRating: pr, ratingRange: rng };
        setUser(updated);
        syncSettings(api, API, friends, pr, rng);
    };

    const addFriend = () => {
        const h = friendInput.trim().toLowerCase();
        if (!h) { setFriendErr("Enter a handle."); return; }
        if (friends.map(f => f.toLowerCase()).includes(h)) { setFriendErr("Already added."); return; }
        setFriendErr("");
        const newFriends = [...friends, h];
        setFriends(newFriends);
        setUser({ ...user, friendHandles: newFriends });
        setFriendInput("");
        syncSettings(api, API, newFriends, user.practiceRating, user.ratingRange ?? 200);
    };

    const removeFriend = (handleToRemove) => {
        const newFriends = friends.filter(f => f !== handleToRemove);
        setFriends(newFriends);
        setUser({ ...user, friendHandles: newFriends });
        syncSettings(api, API, newFriends, user.practiceRating, user.ratingRange ?? 200);
    };

    const TABS = [
        { id: "analyze", label: "Analyze" },
        { id: "plan", label: "Plan", disabled: !analysisReady },
        { id: "backlog", label: "Backlog" },
    ];

    return (
        <div style={{ borderBottom: "1px solid #141414", padding: "0 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#0a0a0a", zIndex: 100 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>⚡ CF Tracker</span>
                <div style={{ display: "flex", gap: 2 }}>
                    {TABS.map(t => (
                        <button key={t.id} onClick={() => !t.disabled && setSection(t.id)} disabled={t.disabled}
                            style={{ padding: "5px 14px", fontSize: 13, borderRadius: 6, border: "none", background: section === t.id ? "#1a1a2e" : "transparent", color: t.disabled ? "#333" : section === t.id ? "#6c47ff" : "#666", cursor: t.disabled ? "not-allowed" : "pointer", fontWeight: section === t.id ? 600 : 400 }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative" }}>
                <div style={{ fontSize: 12, display: "flex", gap: 12, alignItems: "center" }}>
                    {user.currentRating ? <span style={{ color: "#555" }}>Rating: <span style={{ color: "#a78bfa", fontWeight: 600 }}>{user.currentRating}</span></span> : null}
                    {!editingRating ? (
                        <span style={{ color: "#555", display: "flex", alignItems: "center", gap: 5 }}>
                            Practice:&nbsp;<span style={{ color: "#6c47ff", fontWeight: 600 }}>{user.practiceRating || "—"}</span>
                            <span style={{ color: "#333", fontSize: 10 }}>±{user.ratingRange ?? 200}</span>
                            <button onClick={openRatingEdit} style={{ background: "transparent", border: "none", color: "#333", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
                                onMouseOver={e => e.target.style.color = "#6c47ff"} onMouseOut={e => e.target.style.color = "#333"}>✎</button>
                        </span>
                    ) : (
                        <div style={{ position: "absolute", top: 46, right: 90, background: "#111", border: "1px solid #2a2a3e", borderRadius: 10, padding: "14px", zIndex: 300, width: 220, boxShadow: "0 8px 32px #000a" }}>
                            <div style={{ fontSize: 11, color: "#555", marginBottom: 10, letterSpacing: 1 }}>EDIT RATINGS</div>
                            <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>Practice rating</label>
                            <input type="number" value={ratingDraft} onChange={e => setRatingDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && saveRating()} placeholder="e.g. 1400" autoFocus
                                style={{ width: "100%", padding: "6px 8px", fontSize: 13, background: "#0a0a0a", border: "1px solid #222", borderRadius: 6, color: "#fff", outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
                            <label style={{ fontSize: 11, color: "#555", display: "block", marginBottom: 4 }}>Rating range <span style={{ color: "#333" }}>(±, default 200)</span></label>
                            <input type="number" value={rangeDraft} onChange={e => setRangeDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && saveRating()} placeholder="200"
                                style={{ width: "100%", padding: "6px 8px", fontSize: 13, background: "#0a0a0a", border: "1px solid #222", borderRadius: 6, color: "#fff", outline: "none", boxSizing: "border-box", marginBottom: 12 }} />
                            {ratingErr && <div style={{ fontSize: 11, color: "#f87171", marginBottom: 8 }}>{ratingErr}</div>}
                            <div style={{ display: "flex", gap: 6 }}>
                                <button onClick={saveRating} style={{ flex: 1, padding: "6px", fontSize: 12, fontWeight: 600, background: "#6c47ff", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>Save</button>
                                <button onClick={cancelRating} style={{ padding: "6px 10px", fontSize: 12, background: "transparent", color: "#555", border: "1px solid #222", borderRadius: 6, cursor: "pointer" }}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>

                <button onClick={() => { setShowFriends(!showFriends); if (editingRating) cancelRating(); }}
                    style={{ padding: "5px 12px", fontSize: 13, background: "#111", border: "1px solid #222", borderRadius: 8, color: "#ccc", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                    @{user.handle}
                    <span style={{ fontSize: 10, color: "#555" }}>▼</span>
                    {friends.length > 0 && <span style={{ fontSize: 10, background: "#1a1a2e", color: "#6c47ff", padding: "1px 6px", borderRadius: 10 }}>{friends.length}</span>}
                </button>

                <button onClick={onLogout} style={{ padding: "5px 12px", fontSize: 13, background: "transparent", border: "1px solid #222", borderRadius: 8, color: "#555", cursor: "pointer" }}
                    onMouseOver={e => e.target.style.color = "#f87171"} onMouseOut={e => e.target.style.color = "#555"}>
                    Logout
                </button>

                {showFriends && (
                    <div style={{ position: "absolute", top: 42, right: 0, width: 270, background: "#111", border: "1px solid #222", borderRadius: 10, padding: "14px", zIndex: 200, boxShadow: "0 8px 32px #000a" }}>
                        <div style={{ fontSize: 11, color: "#555", marginBottom: 10, letterSpacing: 1 }}>FRIENDS</div>
                        <div style={{ maxHeight: 150, overflowY: "auto", marginBottom: 12 }}>
                            {friends.length === 0 ? <div style={{ fontSize: 12, color: "#333", padding: "6px 0" }}>No friends added yet.</div>
                                : friends.map(f => (
                                    <div key={f} style={{ fontSize: 13, color: "#888", padding: "5px 0", borderBottom: "1px solid #1a1a1a", display: "flex", alignItems: "center", gap: 6 }}>
                                        <span style={{ color: "#444", fontSize: 11 }}>@</span>
                                        <span style={{ flex: 1 }}>{f}</span>
                                        <button onClick={() => removeFriend(f)} style={{ background: "transparent", border: "none", color: "#333", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                                            onMouseOver={e => e.target.style.color = "#f87171"} onMouseOut={e => e.target.style.color = "#333"}>×</button>
                                    </div>
                                ))}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            <input value={friendInput} onChange={e => setFriendInput(e.target.value.toLowerCase())} onKeyDown={e => e.key === "Enter" && addFriend()} placeholder="add cf handle"
                                style={{ flex: 1, padding: "7px 10px", fontSize: 12, background: "#0a0a0a", border: "1px solid #222", borderRadius: 6, color: "#fff", outline: "none" }} />
                            <button onClick={addFriend} style={{ padding: "7px 12px", fontSize: 13, background: "#6c47ff", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>+</button>
                        </div>
                        {friendErr && <div style={{ fontSize: 11, color: "#f87171", marginTop: 8 }}>{friendErr}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}