import { useState } from "react";
import axios from "axios";

export default function PlanPanel({ API, user, plan, setPlan, todoState, setTodoState, hasBacklogAdditions, setHasBacklogAdditions }) {
  const [planDays, setPlanDays] = useState(7);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [open, setOpen]         = useState(1);

  const loadPlan = async (days) => {
    setLoading(true); setError("");
    try {
      const res = await axios.post(`${API}/api/plan`, { handle: user.handle, days: Number(days || planDays) });
      setPlan(res.data);
      // Don't reset todoState — keep solved problems green after replan
      setHasBacklogAdditions(false);
    } catch (e) { setError(e.response?.data?.error || "Error generating plan."); }
    setLoading(false);
  };

  const tickProblem = async (todo, day) => {
    const key = `${day}-${todo.contestId}-${todo.index}`;
    const current = todoState[key] || "pending";

    // If already solved/wrong — allow untick
    if (current === "solved" || current === "wrong") {
      setTodoState(p => { const n={...p}; delete n[key]; return n; });
      try {
        await axios.post(`${API}/api/uncomplete`, { handle:user.handle, day, contestId:todo.contestId, index:todo.index });
      } catch {}
      return;
    }

    if (current === "checking") return;

    // Mark as checking immediately
    setTodoState(p => ({ ...p, [key]: "checking" }));

    try {
      await axios.post(`${API}/api/complete`, { handle:user.handle, day, contestId:todo.contestId, index:todo.index });
      const verify = await axios.post(`${API}/api/verify`, { handle:user.handle, contestId:todo.contestId, index:todo.index });
      const newState = verify.data.solved ? "solved" : "wrong";
      setTodoState(p => ({ ...p, [key]: newState }));
      // Persist to DB
      await axios.post(`${API}/api/progress/save`, { handle:user.handle, key, state:newState });
    } catch {
      setTodoState(p => ({ ...p, [key]: "wrong" }));
      await axios.post(`${API}/api/progress/save`, { handle:user.handle, key, state:"wrong" }).catch(()=>{});
    }
  };

  const allTodos    = plan?.plan?.flatMap(d => d.problems) || [];
  const allKeys     = plan?.plan?.flatMap(d => d.problems.map(p => `${d.day}-${p.contestId}-${p.index}`)) || [];
  const solvedCount = allKeys.filter(k => todoState[k]==="solved").length;
  const wrongCount  = allKeys.filter(k => todoState[k]==="wrong").length;
  const pct         = allTodos.length ? Math.round((solvedCount/allTodos.length)*100) : 0;

  if (!plan) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"60vh", gap:20 }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
        <h2 style={{ fontSize:22, fontWeight:700, marginBottom:8 }}>No plan yet</h2>
        <p style={{ color:"#555", fontSize:14 }}>Go to Analyze tab to generate your plan.</p>
      </div>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <input type="number" value={planDays} onChange={e=>setPlanDays(Math.max(1,Number(e.target.value)))}
          min={1} max={90}
          style={{ width:64, padding:"8px 10px", fontSize:13, background:"#111", border:"1px solid #222", borderRadius:8, color:"#fff", outline:"none", textAlign:"center" }}/>
        <span style={{ fontSize:12, color:"#555" }}>days</span>
        <button onClick={()=>loadPlan(planDays)} disabled={loading}
          style={{ padding:"10px 20px", fontSize:14, fontWeight:600, background:"#6c47ff", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
          {loading ? <><span className="spinner"/>Building...</> : "Generate plan"}
        </button>
      </div>
      {error && <div style={{ padding:"10px 16px", background:"#1a0a0a", border:"1px solid #f87171", borderRadius:8, fontSize:13, color:"#f87171" }}>{error}</div>}
    </div>
  );

  return (
    <div style={{ animation:"fadeIn .3s ease" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:600, marginBottom:4 }}>Your Plan</h2>
          <p style={{ fontSize:13, color:"#555" }}>{plan.totalDays} days · {plan.totalProblems} problems · {plan.problemsPerDay}/day</p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input type="text" inputmode = "numeric" value={planDays} onChange={e=>setPlanDays(Math.max(1,Number(e.target.value)))}
            min={1} max={90}
            style={{ width:56, padding:"6px 8px", fontSize:12, background:"#111", border:"1px solid #222", borderRadius:6, color:"#fff", outline:"none", textAlign:"center" }}/>
          <span style={{ fontSize:11, color:"#555" }}>days</span>
          <button onClick={()=>loadPlan(planDays)} disabled={loading}
            style={{ padding:"7px 14px", fontSize:12, fontWeight:600, background:hasBacklogAdditions?"#1a1000":"#1a1a2e", color:hasBacklogAdditions?"#fbbf24":"#6c47ff", border:`1px solid ${hasBacklogAdditions?"#3a2800":"#1a1a2e"}`, borderRadius:6, cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            {loading ? <span className="spinner"/> : hasBacklogAdditions ? "⚡ Replan with backlog" : "Regenerate"}
          </button>
        </div>
      </div>

      {/* Progress */}
      <div style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:10, padding:"16px", marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:13, color:"#888" }}>Overall progress</span>
          <div style={{ display:"flex", gap:16, fontSize:12 }}>
            <span style={{ color:"#4ade80" }}>✓ {solvedCount} verified</span>
            <span style={{ color:"#f87171" }}>✗ {wrongCount} not on CF</span>
            <span style={{ color:"#6c47ff", fontWeight:600 }}>{pct}% done</span>
          </div>
        </div>
        <div style={{ height:6, background:"#1a1a1a", borderRadius:3, overflow:"hidden" }}>
          <div style={{ height:6, width:`${pct}%`, background:"#6c47ff", borderRadius:3, transition:"width .4s ease" }}/>
        </div>
        <div style={{ fontSize:11, color:"#444", marginTop:8 }}>
          Click a problem to mark done → CF verification runs automatically · Click again to untick
        </div>
      </div>

      {/* Day cards */}
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:24 }}>
        {plan.plan.map(day => {
          const dayKeys   = day.problems.map(p=>`${day.day}-${p.contestId}-${p.index}`);
          const daySolved = dayKeys.filter(k=>todoState[k]==="solved").length;
          const dayPct    = day.problems.length ? Math.round((daySolved/day.problems.length)*100) : 0;
          const allDone   = daySolved === day.problems.length && day.problems.length > 0;

          return (
            <div key={day.day} style={{ background:"#111", border:`1px solid ${allDone?"#0a2a0a":"#1a1a1a"}`, borderRadius:10, overflow:"hidden", transition:"border-color .3s" }}>
              <div onClick={()=>setOpen(open===day.day?null:day.day)}
                style={{ padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:12, color: allDone?"#4ade80":"#444", minWidth:40, fontWeight: allDone?600:400 }}>
                    {allDone?"✓ ":""}Day {day.day}
                  </span>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                    {day.focus.split(" + ").map(t=>(
                      <span key={t} style={{ fontSize:11, padding:"2px 7px", borderRadius:4, background:"#1a1a2e", color:"#a78bfa" }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:11, color:allDone?"#4ade80":"#555" }}>{daySolved}/{day.problems.length}</span>
                  <div style={{ width:40, height:3, background:"#222", borderRadius:2, overflow:"hidden" }}>
                    <div style={{ height:3, width:`${dayPct}%`, background:"#4ade80", borderRadius:2, transition:"width .4s" }}/>
                  </div>
                  <span style={{ color:"#333", fontSize:12 }}>{open===day.day?"▲":"▼"}</span>
                </div>
              </div>

              {open===day.day && (
                <div style={{ borderTop:"1px solid #141414" }}>
                  {day.problems.map((p,i) => {
                    const key   = `${day.day}-${p.contestId}-${p.index}`;
                    const state = todoState[key] || "pending";
                    return (
                      <div key={key} onClick={()=>tickProblem(p,day.day)}
                        style={{ padding:"10px 16px", display:"flex", alignItems:"center", gap:12,
                          borderBottom:i<day.problems.length-1?"1px solid #0f0f0f":"none",
                          opacity:state==="solved"?0.6:1, cursor:"pointer",
                          background:state==="checking"?"#0d0d0d":"transparent",
                          transition:"opacity .3s, background .2s" }}>

                        {/* Checkbox */}
                        <div style={{ width:20, height:20, borderRadius:5, border:`1.5px solid ${state==="solved"?"#4ade80":state==="wrong"?"#f87171":state==="checking"?"#444":"#2a2a2a"}`, background:state==="solved"?"#4ade80":state==="wrong"?"#1a0505":"transparent", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:11, transition:"all .2s" }}>
                          {state==="checking" ? <span className="spin-sm"/> : state==="solved" ? "✓" : state==="wrong" ? "✗" : ""}
                        </div>

                        {/* Rating */}
                        <span style={{ fontSize:11, padding:"2px 6px", borderRadius:4, background:"#1a1a2e", color:"#a78bfa", minWidth:36, textAlign:"center", flexShrink:0 }}>
                          {p.rating}
                        </span>

                        {/* Name */}
                        <span style={{ flex:1, fontSize:13, color:state==="solved"?"#4ade80":state==="wrong"?"#f87171":"#ccc", textDecoration:state==="solved"||state==="wrong"?"line-through":"none", transition:"color .3s" }}>
                          {p.name}
                        </span>

                        {/* Open link */}
                        <a href={p.url} target="_blank" rel="noreferrer"
                          onClick={e=>e.stopPropagation()}
                          style={{ fontSize:11, color:"#333", textDecoration:"none", flexShrink:0 }}
                          onMouseOver={e=>e.target.style.color="#6c47ff"}
                          onMouseOut={e=>e.target.style.color="#333"}>
                          ↗
                        </a>

                        {/* Status label */}
                        <span style={{ fontSize:10, color:state==="solved"?"#4ade80":state==="wrong"?"#f87171":state==="checking"?"#555":"#2a2a2a", minWidth:70, textAlign:"right", flexShrink:0 }}>
                          {state==="solved"?"verified ✓":state==="wrong"?"not on CF":state==="checking"?"checking...":"click to mark"}
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
      <div style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:12, padding:"18px 20px" }}>
        <div style={{ fontSize:11, color:"#555", marginBottom:16, letterSpacing:1 }}>PERFORMANCE</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
          {[
            { label:"Verified solved", value:solvedCount,                              color:"#4ade80" },
            { label:"Not on CF",       value:wrongCount,                               color:"#f87171" },
            { label:"Remaining",       value:allTodos.length-solvedCount-wrongCount,   color:"#888"    },
            { label:"Accuracy",        value:`${pct}%`,                                color:"#6c47ff" },
          ].map(s=>(
            <div key={s.label} style={{ textAlign:"center", padding:"12px", background:"#0d0d0d", borderRadius:8 }}>
              <div style={{ fontSize:26, fontWeight:700, color:s.color }}>{s.value}</div>
              <div style={{ fontSize:11, color:"#444", marginTop:6 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {error && <div style={{ marginTop:12, padding:"10px 14px", background:"#1a0a0a", border:"1px solid #f87171", borderRadius:8, fontSize:13, color:"#f87171" }}>{error}</div>}
    </div>
  );
}