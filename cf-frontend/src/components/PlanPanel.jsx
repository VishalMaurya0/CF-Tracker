import { useState, useEffect } from "react";

// 1. Add api to props
export default function PlanPanel({ API, api, user, plan, setPlan, todoState, setTodoState, hasBacklogAdditions, setHasBacklogAdditions }) {
  const [planDays, setPlanDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(1);
  const [showCompleted, setShowCompleted] = useState(true);
  const [completedProblems, setCompletedProblems] = useState([]);

  // 2. loadPlan
  const loadPlan = async (days) => {
    setLoading(true); setError("");
    setCompletedProblems([]);
    setTodoState({});
    try {
      const res = await api.post(`${API}/api/plan`, { days: Number(days || planDays) });
      setPlan(res.data);
      setHasBacklogAdditions(false);
    } catch (e) { setError(e.response?.data?.error || "Error generating plan."); }
    setLoading(false);
  };

  // 3. tickProblem — replace all 4 axios calls
  const tickProblem = async (todo, day) => {
    const key = `${day}-${todo.contestId}-${todo.index}`;
    const current = todoState[key] || "pending";

    if (current === "solved" || current === "wrong") {
      setTodoState(p => { const n = { ...p }; delete n[key]; return n; });
      try {
        await api.post(`${API}/api/uncomplete`, {
          day: Number(day),
          contestId: todo.contestId, index: todo.index,
        });
      } catch { }
      return;
    }

    if (current === "checking") return;
    setTodoState(p => ({ ...p, [key]: "checking" }));

    try {
      await api.post(`${API}/api/complete`, { day, contestId: todo.contestId, index: todo.index });
      const verify = await api.post(`${API}/api/verify`, { contestId: todo.contestId, index: todo.index });
      const newState = verify.data.solved ? "solved" : "wrong";
      setTodoState(p => ({ ...p, [key]: newState }));
      await api.post(`${API}/api/progress/save`, { key, state: newState, problem: todo, day: Number(day) });
    } catch {
      setTodoState(p => ({ ...p, [key]: "wrong" }));
      await api.post(`${API}/api/progress/save`, { key, state: "wrong", problem: todo, day: Number(day) }).catch(() => { });
    }
  };
  const allTodos = plan?.plan?.flatMap(d => d.problems) || [];
  const allKeys = plan?.plan?.flatMap(d => d.problems.map(p => `${d.day}-${p.contestId}-${p.index}`)) || [];
  // Replace the existing solvedCount / wrongCount / pct lines with:
  const solvedCount = allKeys.filter(k => todoState[k] === "solved").length;
  const wrongCount = allKeys.filter(k => todoState[k] === "wrong").length;
  const completedPanelSolved = completedProblems.filter(p => p.state === "solved").length;
  const completedPanelWrong = completedProblems.filter(p => p.state === "wrong").length;
  // Union: use max of either source to avoid double-counting (same keys)
  const totalSolved = Math.max(solvedCount, completedPanelSolved);
  const totalWrong = Math.max(wrongCount, completedPanelWrong);
  const pct = allTodos.length ? Math.round(((totalSolved + totalWrong) / allTodos.length) * 100) : 0;

  useEffect(() => {
    if (!plan) return;

    setCompletedProblems(prev => {
      const map = new Map();

      // Rebuild from current todoState only
      plan.plan.forEach(day => {
        day.problems.forEach(p => {
          const key = `${day.day}-${p.contestId}-${p.index}`;
          const state = todoState[key];
          if (state === "solved" || state === "wrong") {
            map.set(key, { ...p, key, day: day.day, state });
          }
          // If key not in todoState or state is "pending"/"checking" → not added → effectively removed
        });
      });

      // Also keep any from prev that aren't in the current plan days (edge case)
      // but DO respect todoState — if key was deleted, drop it
      prev.forEach(p => {
        if (!map.has(p.key) && todoState[p.key]) {
          map.set(p.key, p);
        }
      });

      return Array.from(map.values());
    });
  }, [todoState, plan]);


  // 4. progress load useEffect — replace axios.get
  useEffect(() => {
    const loadProgress = async () => {
      if (!user?.handle) return;
      try {
        const res = await api.get(`${API}/api/progress/load`);
        if (!res.data.success) return;
        if (res.data?.states) {
          const loaded = Object.entries(res.data.states)
            .filter(([_, v]) => v.state === "solved" || v.state === "wrong")
            .map(([key, v]) => ({
              ...v.problem,
              key,
              day: v.day,
              state: v.state,
            }));
          setCompletedProblems(loaded);
        }
      } catch (err) {
        console.error("Failed to load progress", err);
      }
    };
    loadProgress();
  }, [user?.handle]);

  if (!plan) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 20 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>No plan yet</h2>
        <p style={{ color: "#555", fontSize: 14 }}>Go to Analyze tab to generate your plan.</p>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="number" value={planDays} onChange={e => setPlanDays(Math.max(1, Number(e.target.value)))}
          min={1} max={90}
          style={{ width: 64, padding: "8px 10px", fontSize: 13, background: "#111", border: "1px solid #222", borderRadius: 8, color: "#fff", outline: "none", textAlign: "center" }} />
        <span style={{ fontSize: 12, color: "#555" }}>days</span>
        <button onClick={() => loadPlan(planDays)} disabled={loading}
          style={{ padding: "10px 20px", fontSize: 14, fontWeight: 600, background: "#6c47ff", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          {loading ? <><span className="spinner" />Building...</> : "Generate plan"}
        </button>
      </div>
      {error && <div style={{ padding: "10px 16px", background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 8, fontSize: 13, color: "#f87171" }}>{error}</div>}
    </div>
  );

  return (
    <div style={{ animation: "fadeIn .3s ease" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Your Plan</h2>
          <p style={{ fontSize: 13, color: "#555" }}>{plan.totalDays} days · {plan.totalProblems} problems · {plan.problemsPerDay}/day</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="number" value={planDays} onChange={e => setPlanDays(Math.max(1, Number(e.target.value)))}
            min={1} max={90}
            style={{ width: 56, padding: "6px 8px", fontSize: 12, background: "#111", border: "1px solid #222", borderRadius: 6, color: "#fff", outline: "none", textAlign: "center" }} />
          <span style={{ fontSize: 11, color: "#555" }}>days</span>
          <button onClick={() => loadPlan(planDays)} disabled={loading}
            style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, background: hasBacklogAdditions ? "#1a1000" : "#1a1a2e", color: hasBacklogAdditions ? "#fbbf24" : "#6c47ff", border: `1px solid ${hasBacklogAdditions ? "#3a2800" : "#1a1a2e"}`, borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {loading ? <span className="spinner" /> : hasBacklogAdditions ? "⚡ Replan with backlog" : "Regenerate"}
          </button>
        </div>
      </div>

      {/* Progress */}
      <div style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 10, padding: "16px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: "#888" }}>Overall progress</span>
          <div style={{ display: "flex", gap: 16, fontSize: 12 }}>
            <span style={{ color: "#4ade80" }}>✓ {totalSolved} verified</span>
            <span style={{ color: "#f87171" }}>✗ {totalWrong} not on CF</span>
            <span style={{ color: "#6c47ff", fontWeight: 600 }}>{pct}% done</span>
          </div>
        </div>
        <div style={{ height: 6, background: "#1a1a1a", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: 6, width: `${pct}%`, background: "#6c47ff", borderRadius: 3, transition: "width .4s ease" }} />
        </div>
        <div style={{ fontSize: 11, color: "#444", marginTop: 8 }}>
          Click a problem to mark done → CF verification runs · Click again to untick
        </div>
      </div>

      {/* Day cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {plan.plan.map(day => {
          const dayKeys = day.problems.map(p => `${day.day}-${p.contestId}-${p.index}`);
          const daySolved = dayKeys.filter(k => todoState[k] === "solved").length;
          const dayPct = day.problems.length ? Math.round((daySolved / day.problems.length) * 100) : 0;
          const allDone = daySolved === day.problems.length && day.problems.length > 0;

          return (
            <div key={day.day} style={{ background: "#111", border: `1px solid ${allDone ? "#0a2a0a" : "#1a1a1a"}`, borderRadius: 10, overflow: "hidden", transition: "border-color .3s" }}>
              <div onClick={() => setOpen(open === day.day ? null : day.day)}
                style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: allDone ? "#4ade80" : "#444", minWidth: 40, fontWeight: allDone ? 600 : 400 }}>
                    {allDone ? "✓ " : ""}Day {day.day}
                  </span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {day.focus.split(" + ").map(t => (
                      <span key={t} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 4, background: "#1a1a2e", color: "#a78bfa" }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11, color: allDone ? "#4ade80" : "#555" }}>{daySolved}/{day.problems.length}</span>
                  <div style={{ width: 40, height: 3, background: "#222", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: 3, width: `${dayPct}%`, background: "#4ade80", borderRadius: 2, transition: "width .4s" }} />
                  </div>
                  <span style={{ color: "#333", fontSize: 12 }}>{open === day.day ? "▲" : "▼"}</span>
                </div>
              </div>

              {open === day.day && (
                <div style={{ borderTop: "1px solid #141414" }}>
                  {day.problems.map((p, i) => {
                    const key = `${day.day}-${p.contestId}-${p.index}`;
                    const state = todoState[key] || "pending";
                    return (
                      <div key={key} onClick={() => tickProblem(p, day.day)}
                        style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, borderBottom: i < day.problems.length - 1 ? "1px solid #0f0f0f" : "none", opacity: state === "solved" ? 0.5 : 1, cursor: "pointer", background: state === "checking" ? "#0d0d0d" : "transparent", transition: "opacity .3s" }}>

                        <div style={{ width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${state === "solved" ? "#4ade80" : state === "wrong" ? "#f87171" : state === "checking" ? "#444" : "#2a2a2a"}`, background: state === "solved" ? "#4ade80" : state === "wrong" ? "#1a0505" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, transition: "all .2s" }}>
                          {state === "checking" ? <span className="spin-sm" /> : state === "solved" ? "✓" : state === "wrong" ? "✗" : ""}
                        </div>

                        <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#1a1a2e", color: "#a78bfa", minWidth: 36, textAlign: "center", flexShrink: 0 }}>
                          {p.rating}
                        </span>

                        <span style={{ flex: 1, fontSize: 13, color: state === "solved" ? "#4ade80" : state === "wrong" ? "#f87171" : "#ccc", textDecoration: state === "solved" || state === "wrong" ? "line-through" : "none", transition: "color .3s" }}>
                          {p.name}
                        </span>

                        <a href={p.url} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 11, color: "#333", textDecoration: "none", flexShrink: 0 }}
                          onMouseOver={e => e.target.style.color = "#6c47ff"}
                          onMouseOut={e => e.target.style.color = "#333"}>↗</a>

                        <span style={{ fontSize: 10, color: state === "solved" ? "#4ade80" : state === "wrong" ? "#f87171" : state === "checking" ? "#555" : "#2a2a2a", minWidth: 70, textAlign: "right", flexShrink: 0 }}>
                          {state === "solved" ? "verified ✓" : state === "wrong" ? "not on CF" : state === "checking" ? "checking..." : "click to mark"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Performance */}
      <div style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 12, padding: "18px 20px" }}>
        <div style={{ fontSize: 11, color: "#555", marginBottom: 16, letterSpacing: 1 }}>PERFORMANCE</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {[
            { label: "Verified solved", value: totalSolved, color: "#4ade80" },
            { label: "Not on CF", value: totalWrong, color: "#f87171" },
            { label: "Remaining", value: allTodos.length - totalSolved - totalWrong, color: "#888" },
            { label: "Accuracy", value: `${pct}%`, color: "#6c47ff" },
          ].map(s => (
            <div key={s.label} style={{ textAlign: "center", padding: "12px", background: "#0d0d0d", borderRadius: 8 }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Completed problems section ── */}
      {completedProblems.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div onClick={() => setShowCompleted(!showCompleted)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: "12px 0", borderTop: "1px solid #1a1a1a" }}>
            <span style={{ fontSize: 13, color: "#4ade80", fontWeight: 500 }}>
              ✓ Completed ({completedProblems.length})
            </span>
            <span style={{ fontSize: 12, color: "#333" }}>{showCompleted ? "▲" : "▼"}</span>
          </div>

          {showCompleted && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {completedProblems.map(p => {
                const isVerified = p.state === "solved";
                const color = isVerified ? "#4ade80" : "#f87171";
                const bg = isVerified ? "#0a1a0a" : "#1a0505";
                const border = isVerified ? "#0d2a0d" : "#2a0d0d";

                return (
                  <div key={p.key}
                    style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>

                    <div
                      onClick={() => tickProblem(p, p.day)}
                      title="Click to untick"
                      style={{
                        width: 20, height: 20, borderRadius: 5,
                        border: `1.5px solid ${color}`, background: color,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, flexShrink: 0, color: "#000",
                        cursor: "pointer",
                        transition: "opacity .2s",
                      }}
                      onMouseOver={e => e.currentTarget.style.opacity = "0.7"}
                      onMouseOut={e => e.currentTarget.style.opacity = "1"}
                    >
                      {isVerified ? "✓" : "✗"}
                    </div>

                    <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, background: "#1a1a2e", color: "#a78bfa", minWidth: 36, textAlign: "center", flexShrink: 0 }}>
                      {p.rating}
                    </span>

                    <span style={{ flex: 1, fontSize: 13, color, textDecoration: "line-through" }}>
                      {p.name}
                    </span>

                    <span style={{ fontSize: 11, color: isVerified ? "#1a4a1a" : "#4a1a1a", flexShrink: 0 }}>{p.topic}</span>

                    <a href={p.url} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, color: isVerified ? "#1a4a1a" : "#4a1a1a", textDecoration: "none", flexShrink: 0 }}
                      onMouseOver={e => e.target.style.color = color}
                      onMouseOut={e => e.target.style.color = isVerified ? "#1a4a1a" : "#4a1a1a"}>↗</a>

                    <span style={{ fontSize: 10, color, flexShrink: 0 }}>
                      {isVerified ? "verified ✓" : "not on CF ✗"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <div style={{ marginTop: 12, padding: "10px 14px", background: "#1a0a0a", border: "1px solid #f87171", borderRadius: 8, fontSize: 13, color: "#f87171" }}>{error}</div>}
    </div>
  );
}