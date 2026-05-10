import { useState } from "react";
import axios from "axios";

export default function Today({ API, handle }) {
  const [day, setDay]         = useState(1);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [error, setError]     = useState("");

  const load = async () => {
    if (!handle) { setError("Run Setup first."); return; }
    setLoading(true); setError("");
    try {
      const res = await axios.get(`${API}/api/today?handle=${handle}&day=${day}`);
      setData(res.data);
    } catch (e) { setError(e.response?.data?.error || "Error"); }
    setLoading(false);
  };

  const complete = async (todo) => {
    const key = `${todo.contestId}-${todo.index}`;
    setCompleting(key);
    try {
      await axios.post(`${API}/api/complete`, {
        handle, day: Number(day),
        contestId: todo.contestId,
        index: todo.index,
      });
      // Update local state
      setData((prev) => ({
        ...prev,
        todos: prev.todos.map((t) =>
          t.contestId === todo.contestId && t.index === todo.index
            ? { ...t, done: true } : t
        ),
      }));
    } catch (e) { setError(e.response?.data?.error || "Error"); }
    setCompleting(null);
  };

  const done  = data?.todos.filter((t) => t.done).length || 0;
  const total = data?.todos.length || 0;
  const pct   = total ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Today's Tasks</h2>
          <p style={{ color: "#555", fontSize: 13 }}>Solve your daily problems and mark them done.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" min={1} value={day} onChange={(e) => setDay(e.target.value)}
            style={{ width: 64, padding: "8px 10px", fontSize: 13, background: "#111", border: "1px solid #222", borderRadius: 8, color: "#fff", outline: "none", textAlign: "center" }} />
          <button onClick={load} disabled={loading}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#6c47ff", color: "#fff", border: "none", borderRadius: 8, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 8 }}>
            {loading ? <><span className="spinner" /> Loading...</> : "Load day"}
          </button>
        </div>
      </div>

      {error && <div style={{ padding: "10px 14px", background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 8, fontSize: 13, color: "#f87171", marginBottom: 16 }}>{error}</div>}

      {data && (
        <>
          {/* Progress */}
          <div style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 10, padding: "16px", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: "#888" }}>Day {data.day} progress</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: pct === 100 ? "#4ade80" : "#fff" }}>{done}/{total} done</span>
            </div>
            <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: 6, width: `${pct}%`, background: pct === 100 ? "#4ade80" : "#6c47ff", borderRadius: 3, transition: "width .4s ease" }} />
            </div>
            {pct === 100 && (
              <div style={{ marginTop: 10, fontSize: 13, color: "#4ade80", textAlign: "center" }}>
                🎉 Day complete! Great work.
              </div>
            )}
          </div>

          {/* Todo list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.todos.map((todo) => {
              const key = `${todo.contestId}-${todo.index}`;
              const isCompleting = completing === key;
              return (
                <div key={key} style={{
                  background: "#111",
                  border: `1px solid ${todo.done ? "#0a2a0a" : "#1a1a1a"}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  opacity: todo.done ? 0.55 : 1,
                  transition: "opacity .3s, border-color .3s",
                }}>
                  {/* Checkbox */}
                  <button onClick={() => !todo.done && complete(todo)} disabled={todo.done || isCompleting}
                    style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${todo.done ? "#4ade80" : "#333"}`, background: todo.done ? "#4ade80" : "transparent", cursor: todo.done ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 13, transition: "all .2s" }}>
                    {isCompleting ? <span className="spinner" style={{ width: 12, height: 12 }} /> : todo.done ? "✓" : ""}
                  </button>

                  {/* Rating */}
                  <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#1a1a2e", color: "#a78bfa", minWidth: 38, textAlign: "center" }}>
                    {todo.rating}
                  </span>

                  {/* Name */}
                  <a href={todo.url} target="_blank" rel="noreferrer"
                    style={{ flex: 1, fontSize: 14, color: todo.done ? "#555" : "#ccc", textDecoration: todo.done ? "line-through" : "none" }}
                    onMouseOver={(e) => { if (!todo.done) e.target.style.color = "#6c47ff"; }}
                    onMouseOut={(e) => { if (!todo.done) e.target.style.color = "#ccc"; }}>
                    {todo.name}
                  </a>

                  {/* Topic tag */}
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#111", border: "1px solid #222", color: "#555" }}>
                    {todo.topic}
                  </span>

                  {/* CF link */}
                  <a href={todo.url} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: "#444", textDecoration: "none" }}
                    onMouseOver={(e) => e.target.style.color = "#6c47ff"}
                    onMouseOut={(e) => e.target.style.color = "#444"}>
                    Open ↗
                  </a>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}