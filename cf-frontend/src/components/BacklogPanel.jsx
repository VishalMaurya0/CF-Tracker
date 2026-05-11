import { useState, useEffect } from "react";

export default function BacklogPanel({ API, api, user, onAddedToQueue }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState({});
  const [syncResult, setSyncResult] = useState(null);
  const [queuedKeys, setQueuedKeys] = useState(new Set());

  // On mount — load from DB instantly, no CF calls
  useEffect(() => {
    loadFromDB();
  }, []);

  const loadFromDB = async () => {
    setLoading(true); setError("");
    try {
      const [backlogRes, queueRes] = await Promise.all([
        api.get(`${API}/api/backlog`, { params: { handle: user.handle } }),
        api.get(`${API}/api/queue/added`, { params: { handle: user.handle } }),
      ]);
      setData(backlogRes.data);
      setQueuedKeys(new Set(queueRes.data.keys || []));
    } catch (e) { setError(e.response?.data?.error || "Error loading backlog."); }
    setLoading(false);
  };

  const fetchAndSync = async () => {
    if (user.friendHandles?.length === 0) {
      setError("Add friends first from the top bar.");
      return;
    }
    setSyncing(true); setError(""); setSyncResult(null);
    try {
      const res = await api.post(`${API}/api/friends/sync`, { handle: user.handle });
      setSyncResult(res.data);
      await loadFromDB();
    } catch (e) { setError(e.response?.data?.error || "Error syncing."); }
    setSyncing(false);
  };

  const addToQueue = async (p) => {
    const key = `${p.contestId}-${p.index}`;
    setAdding(prev => ({ ...prev, [key]: true }));
    try {
      await api.post(`${API}/api/queue/add`, {
        handle: user.handle, contestId: p.contestId, index: p.index,
        name: p.name, rating: p.rating, tags: p.tags,
        topic: p.tags?.[0] || "backlog", url: p.url,
      });
      setQueuedKeys(prev => new Set([...prev, key]));
      onAddedToQueue();
    } catch (e) { setError(e.response?.data?.error || "Error adding."); }
    setAdding(prev => ({ ...prev, [key]: false }));
  };

  const filtered = !data ? [] : data.backlog.filter(p => {
    if (filter === "near") return p.nearMyRating;
    if (filter === "attempted") return p.attemptedBy?.length > 0;
    if (filter === "friends2") return p.friendSolveCount >= 2;
    return true;
  });

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Friend Backlog</h2>
          <p style={{ color: "#555", fontSize: 13 }}>
            Problems your friends solved that you haven't.
            {data?.lastSynced && (
              <span style={{ color: "#333", marginLeft: 8 }}>
                Last synced: {new Date(data.lastSynced).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <button onClick={fetchAndSync} disabled={syncing || loading}
          style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: syncing ? "#1a1a1a" : "#6c47ff", color: "#fff", border: "none", borderRadius: 8, cursor: syncing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          {syncing ? <><span className="spinner" />Syncing from CF...</> : "Fetch backlog"}
        </button>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div style={{ background: "#0a1a0a", border: "1px solid #1a3a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#4ade80" }}>
          ✓ Synced — {syncResult.myNewSolved} new problems you solved ·{" "}
          {syncResult.friends?.map(f => `${f.friend}: +${f.addedSolved} solved`).join(" · ")}
        </div>
      )}

      {error && (
        <div style={{ padding: "10px 14px", background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 8, fontSize: 13, color: "#f87171", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "40vh" }}>
          <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
        </div>
      )}

      {/* Empty states */}
      {!loading && data && data.backlog.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "40vh", gap: 12 }}>
          <div style={{ fontSize: 40 }}>👥</div>
          <p style={{ color: "#444", fontSize: 14, textAlign: "center" }}>
            {user.friendHandles?.length === 0
              ? "Add friends from the top bar first, then click Fetch backlog."
              : "No backlog yet. Click \"Fetch backlog\" to sync from CF."}
          </p>
        </div>
      )}

      {!loading && data && data.backlog.length > 0 && (
        <>
          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Total unsolved", value: data.total },
              { label: "Near your rating", value: data.nearMyRating },
              { label: "Practice rating", value: data.practiceRating },
            ].map(s => (
              <div key={s.label} style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 10, padding: "12px 16px" }}>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{s.value}</div>
                <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[["all", "All"], ["near", "Near my rating"], ["friends2", "2+ friends solved"], ["attempted", "Friends attempted"]].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                style={{ padding: "5px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #222", background: filter === val ? "#6c47ff" : "transparent", color: filter === val ? "#fff" : "#666", cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>

          {/* Problem list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(p => {
              const key = `${p.contestId}-${p.index}`;
              const isAdded = queuedKeys.has(`${p.contestId}-${p.index}`);
              const isAdding = adding[key];
              return (
                <div key={key} style={{ background: "#111", border: `1px solid ${p.nearMyRating ? "#1a1a2e" : "#141414"}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Rating */}
                  <div style={{
                    minWidth: 44, textAlign: "center", fontSize: 12, fontWeight: 600, padding: "3px 6px", borderRadius: 6,
                    background: !p.rating ? "#1a1a1a" : p.rating < 1400 ? "#0a1a0a" : p.rating < 1600 ? "#1a1a0a" : "#1a0a0a",
                    color: !p.rating ? "#444" : p.rating < 1400 ? "#4ade80" : p.rating < 1600 ? "#fbbf24" : "#f87171"
                  }}>
                    {p.rating || "?"}
                  </div>

                  {/* Name + tags */}
                  <div style={{ flex: 1 }}>
                    <a href={p.url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 14, color: "#e5e5e5", textDecoration: "none", fontWeight: 500 }}
                      onMouseOver={e => e.target.style.color = "#6c47ff"}
                      onMouseOut={e => e.target.style.color = "#e5e5e5"}>
                      {p.name}
                    </a>
                    <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                      {p.tags?.slice(0, 4).map(t => (
                        <span key={t} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#1a1a1a", color: "#555" }}>{t}</span>
                      ))}
                      {p.nearMyRating && (
                        <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#1a1040", color: "#a78bfa" }}>near rating</span>
                      )}
                    </div>
                  </div>

                  {/* Friend info */}
                  <div style={{ textAlign: "right", fontSize: 12, minWidth: 120 }}>
                    {p.solvedBy?.length > 0 && <div style={{ color: "#4ade80" }}>✓ {p.solvedBy.join(", ")}</div>}
                    {p.attemptedBy?.length > 0 && <div style={{ color: "#fbbf24", marginTop: 2 }}>⚡ {p.attemptedBy.join(", ")}</div>}
                  </div>

                  {/* Add to queue */}
                  <button onClick={() => !isAdded && addToQueue(p)} disabled={isAdded || isAdding}
                    style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6, border: `1px solid ${isAdded ? "#0a2a0a" : "#222"}`, background: isAdded ? "#0a2a0a" : "transparent", color: isAdded ? "#4ade80" : "#666", cursor: isAdded ? "default" : "pointer", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, transition: "all .2s" }}>
                    {isAdding ? <span className="spin-sm" /> : isAdded ? "✓ Added" : "+ Queue"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}