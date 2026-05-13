import { useState, useEffect, useCallback } from "react";

const PAGE_SIZE = 20;

export default function BacklogPanel({ API, api, user, analysis, onAddedToQueue }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState({});
  const [syncResult, setSyncResult] = useState(null);
  const [queuedKeys, setQueuedKeys] = useState(new Set());
  const [page, setPage] = useState(1);

  useEffect(() => { loadFromDB(); }, []);

  // Reset to page 1 when filter changes
  useEffect(() => { setPage(1); }, [filter]);

  const CACHE_KEY = `backlog_cache_${user?.handle}`;

  const loadFromDB = async () => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      try { setData(JSON.parse(cached)); setLoading(false); } catch { }
    }

    setError("");
    try {
      // Phase 1: quick first page (fast)
      const [quickRes, queueRes] = await Promise.all([
        api.get(`${API}/api/backlog?quick=1`),
        api.get(`${API}/api/queue/added`),
      ]);
      setData(quickRes.data);
      setQueuedKeys(new Set(queueRes.data.keys || []));
      setLoading(false);
      localStorage.setItem(CACHE_KEY, JSON.stringify(quickRes.data));

      // Phase 2: full data in background (no loading state)
      const fullRes = await api.get(`${API}/api/backlog`);
      setData(fullRes.data);
      localStorage.setItem(CACHE_KEY, JSON.stringify(fullRes.data));
    } catch (e) {
      if (!data) setError(e.response?.data?.error || "Error loading backlog.");
      setLoading(false);
    }
  };

  // ── new state ──────────────────────────────────────────────────────────────
  const [syncLog, setSyncLog] = useState([]);   // live log lines
  const [showSelector, setShowSelector] = useState(false); // friend picker modal
  const [selectedFriends, setSelectedFriends] = useState(new Set()); // checked friends
  // ── replace fetchAndSync ───────────────────────────────────────────────────
  const fetchAndSync = async (friendsToFetch) => {
    if (!user.friendHandles?.length) { setError("Add friends first."); return; }
    setSyncing(true); setError(""); setSyncResult(null); setSyncLog([]);

    const token = localStorage.getItem("cf_token"); // your key here
    const friendParam = friendsToFetch?.length
      ? `friends=${encodeURIComponent(friendsToFetch.join(","))}&`
      : "";

    const url = `${API}/api/friends/sync/stream?${friendParam}token=${token}`;
    const es = new EventSource(url);

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data);
      setSyncLog(prev => [...prev, d]);
    });

    es.addEventListener("done", (e) => {
      const d = JSON.parse(e.data);
      setSyncResult(d);
      loadFromDB();
      setSyncing(false);
      es.close();
    });

    es.addEventListener("error", () => {
      // only show error if we never got a done event
      setSyncing(false);
      setError("Sync failed. Check connection.");
      es.close();
    });
  };

  // ── friend selector: open with pre-selected = all friends ─────────────────
  const openSelector = () => {
    setSelectedFriends(new Set(user.friendHandles));
    setShowSelector(true);
  };

  const addToQueue = async (p) => {
    const key = `${p.contestId}-${p.index}`;
    setAdding(prev => ({ ...prev, [key]: true }));
    const weakTopicNames = analysis.weakTopics.map(t => t.topic);
    const practiceRating = user.practiceRating;
    try {
      await api.post(`${API}/api/queue/add`, {
        contestId: p.contestId, index: p.index,
        name: p.name, rating: p.rating, practiceRating, tags: p.tags,
        topic: p.tags?.[0] || "backlog", url: p.url, weakTopicNames,
      });
      setQueuedKeys(prev => new Set([...prev, key]));
      onAddedToQueue();
    } catch (e) { setError(e.response?.data?.error || "Error adding."); }
    setAdding(prev => ({ ...prev, [key]: false }));
  };

  const allFiltered = !data ? [] : data.backlog.filter(p => {
    if (filter === "near") return p.nearMyRating;
    if (filter === "attempted") return p.attemptedBy?.length > 0;
    if (filter === "friends2") return p.friendSolveCount >= 2;
    return true;
  });

  const totalPages = Math.ceil(allFiltered.length / PAGE_SIZE);
  const paginated = allFiltered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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


        {/* ── Fetch button → opens selector ── */}
        <button onClick={openSelector} disabled={syncing || loading}
          style={{
            padding: "8px 16px", fontSize: 13, fontWeight: 600,
            background: syncing ? "#1a1a1a" : "#6c47ff", color: "#fff",
            border: "none", borderRadius: 8, cursor: syncing ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 8
          }}>
          {syncing ? <><span className="spinner" />Syncing...</> : "Fetch backlog"}
        </button>

        {/* ── Friend selector modal ── */}
        {showSelector && !syncing && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.7)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100
          }}>
            <div style={{
              background: "#111", border: "1px solid #222", borderRadius: 12,
              padding: 24, width: 360, maxWidth: "90vw"
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Choose friends to re-fetch</h3>
              <p style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>
                Unchecked friends will use cached data (faster).
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                {user.friendHandles.map(f => {
                  const checked = selectedFriends.has(f);
                  return (
                    <label key={f} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                      background: checked ? "#1a1040" : "#0d0d0d",
                      border: `1px solid ${checked ? "#6c47ff" : "#1a1a1a"}`
                    }}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        setSelectedFriends(prev => {
                          const next = new Set(prev);
                          next.has(f) ? next.delete(f) : next.add(f);
                          return next;
                        });
                      }} style={{ accentColor: "#6c47ff" }} />
                      <span style={{ fontSize: 14, color: "#e5e5e5" }}>{f}</span>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowSelector(false)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #222",
                    background: "transparent", color: "#666", cursor: "pointer", fontSize: 13
                  }}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowSelector(false);
                    fetchAndSync([...selectedFriends]);
                  }}
                  disabled={selectedFriends.size === 0}
                  style={{
                    flex: 2, padding: "8px 0", borderRadius: 8, border: "none",
                    background: selectedFriends.size === 0 ? "#1a1a1a" : "#6c47ff",
                    color: selectedFriends.size === 0 ? "#333" : "#fff",
                    cursor: selectedFriends.size === 0 ? "not-allowed" : "pointer",
                    fontWeight: 600, fontSize: 13
                  }}>
                  Fetch {selectedFriends.size} friend{selectedFriends.size !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ── Live sync log ── */}
      {syncing && syncLog.length > 0 && (
        <div style={{
          background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 10,
          padding: "14px 16px", marginBottom: 16, fontFamily: "monospace", fontSize: 12
        }}>
          {syncLog.map((entry, i) => {
            const isLatest = i === syncLog.length - 1;
            const color =
              entry.step === "you_done" ? "#4ade80" :
                entry.step === "friend_done" ? "#a78bfa" :
                  entry.step === "backlog" ? "#fbbf24" : "#555";
            return (
              <div key={i} style={{ color, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
                {isLatest && <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5, flexShrink: 0 }} />}
                {!isLatest && <span style={{ width: 8, flexShrink: 0, color: "#333" }}>✓</span>}
                {entry.message}
              </div>
            );
          })}
        </div>
      )}
      {/* Sync result */}
      {syncResult && (
        <div style={{ background: "#0a1a0a", border: "1px solid #1a3a1a", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#4ade80" }}>
          ✓ Synced — {syncResult.myNewSolved} new solved ·{" "}
          {syncResult.friends?.map(f => `${f.friend}: +${f.addedSolved}`).join(" · ")}
        </div>
      )}

      {error && <div style={{ padding: "10px 14px", background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 8, fontSize: 13, color: "#f87171", marginBottom: 16 }}>{error}</div>}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "40vh" }}>
          <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
        </div>
      )}

      {!loading && data && data.backlog.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "40vh", gap: 12 }}>
          <div style={{ fontSize: 40 }}>👥</div>
          <p style={{ color: "#444", fontSize: 14, textAlign: "center" }}>
            {!user.friendHandles?.length
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

          {/* Filters + page info */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {[["all", "All"], ["near", "Near my rating"], ["friends2", "2+ friends solved"], ["attempted", "Friends attempted"]].map(([val, label]) => (
                <button key={val} onClick={() => setFilter(val)}
                  style={{ padding: "5px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #222", background: filter === val ? "#6c47ff" : "transparent", color: filter === val ? "#fff" : "#666", cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "#444" }}>
              {allFiltered.length} problems · page {page}/{totalPages || 1}
            </span>
          </div>

          {/* Problem list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {paginated.map(p => {
              const key = `${p.contestId}-${p.index}`;
              const isAdded = queuedKeys.has(key);
              const isAdding = adding[key];
              return (
                <div key={key} style={{ background: "#111", border: `1px solid ${p.nearMyRating ? "#1a1a2e" : "#141414"}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    minWidth: 44, textAlign: "center", fontSize: 12, fontWeight: 600, padding: "3px 6px", borderRadius: 6,
                    background: !p.rating ? "#1a1a1a" : p.rating < 1400 ? "#0a1a0a" : p.rating < 1600 ? "#1a1a0a" : "#1a0a0a",
                    color: !p.rating ? "#444" : p.rating < 1400 ? "#4ade80" : p.rating < 1600 ? "#fbbf24" : "#f87171"
                  }}>
                    {p.rating || "?"}
                  </div>

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
                      {p.nearMyRating && <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "#1a1040", color: "#a78bfa" }}>near rating</span>}
                    </div>
                  </div>

                  <div style={{ textAlign: "right", fontSize: 12, minWidth: 120 }}>
                    {p.solvedBy?.length > 0 && <div style={{ color: "#4ade80" }}>✓ {p.solvedBy.join(", ")}</div>}
                    {p.attemptedBy?.length > 0 && <div style={{ color: "#fbbf24", marginTop: 2 }}>⚡ {p.attemptedBy.join(", ")}</div>}
                  </div>

                  <button onClick={() => !isAdded && addToQueue(p)} disabled={isAdded || isAdding}
                    style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6, border: `1px solid ${isAdded ? "#0a2a0a" : "#222"}`, background: isAdded ? "#0a2a0a" : "transparent", color: isAdded ? "#4ade80" : "#666", cursor: isAdded ? "default" : "pointer", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, transition: "all .2s" }}>
                    {isAdding ? <span className="spin-sm" /> : isAdded ? "✓ Added" : "+ Queue"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 20 }}>
              <button onClick={() => { setPage(1); window.scrollTo(0, 0); }} disabled={page === 1}
                style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #222", background: "transparent", color: page === 1 ? "#333" : "#666", cursor: page === 1 ? "not-allowed" : "pointer" }}>
                «
              </button>
              <button onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 0); }} disabled={page === 1}
                style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #222", background: "transparent", color: page === 1 ? "#333" : "#666", cursor: page === 1 ? "not-allowed" : "pointer" }}>
                ‹ Prev
              </button>

              {/* Page numbers — show 5 around current */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                .reduce((acc, n, i, arr) => {
                  if (i > 0 && n - arr[i - 1] > 1) acc.push("...");
                  acc.push(n);
                  return acc;
                }, [])
                .map((n, i) => n === "..." ? (
                  <span key={`dots-${i}`} style={{ fontSize: 12, color: "#333", padding: "0 4px" }}>…</span>
                ) : (
                  <button key={n} onClick={() => { setPage(n); window.scrollTo(0, 0); }}
                    style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: `1px solid ${page === n ? "#6c47ff" : "#222"}`, background: page === n ? "#6c47ff" : "transparent", color: page === n ? "#fff" : "#666", cursor: "pointer", minWidth: 32 }}>
                    {n}
                  </button>
                ))
              }

              <button onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo(0, 0); }} disabled={page === totalPages}
                style={{ padding: "6px 12px", fontSize: 12, borderRadius: 6, border: "1px solid #222", background: "transparent", color: page === totalPages ? "#333" : "#666", cursor: page === totalPages ? "not-allowed" : "pointer" }}>
                Next ›
              </button>
              <button onClick={() => { setPage(totalPages); window.scrollTo(0, 0); }} disabled={page === totalPages}
                style={{ padding: "6px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #222", background: "transparent", color: page === totalPages ? "#333" : "#666", cursor: page === totalPages ? "not-allowed" : "pointer" }}>
                »
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}