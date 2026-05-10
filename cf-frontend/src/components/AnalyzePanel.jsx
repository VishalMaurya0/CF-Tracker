import { useState, useEffect } from "react";
import axios from "axios";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Cell } from "recharts";


const API_LOG_STEPS = [
  { msg:"Connecting to Codeforces API...",       delay:0   },
  { msg:"Fetching your recent submissions...",    delay:800 },
  { msg:"Building topic performance stats...",   delay:2200 },
  { msg:"Identifying weak topics...",            delay:3200 },
  { msg:"Sending data to AI for analysis...",    delay:4200 },
  { msg:"Fetching real CF problems for queue...", delay:6500 },
  { msg:"Scoring problems by priority...",       delay:8000 },
  { msg:"Saving priority queue to MongoDB...",   delay:9000 },
];

export default function AnalyzePanel({ API, user, analysis, setAnalysis, onGoToPlan }) {
  const [days, setDays]                           = useState(30);
  const [lastAnalysisDays, setLastAnalysisDays]   = useState(30);
  const [planDays, setPlanDays]                   = useState(7);
  const [loading, setLoading]                     = useState(false);
  const [planning, setPlanning]                   = useState(false);
  const [error, setError]                         = useState("");
  const [log, setLog]                             = useState([]);

  const runAnalysis = async () => {
    setLoading(true); setError(""); setLog([]);

    // Show log steps with delays
    API_LOG_STEPS.forEach(step => {
      setTimeout(() => {
        setLog(prev => [...prev, step.msg]);
      }, step.delay);
    });

    try {
      const res = await axios.post(`${API}/api/analyze`, { handle: user.handle, days: Number(days) });
      setLog(prev => [...prev, `✓ Done — ${res.data.priorityQueueSize} problems queued.`]);
      setTimeout(() => setAnalysis(res.data), 600);
      setLastAnalysisDays(days);
    } catch (e) {
      setError(e.response?.data?.error || "Error running analysis.");
    }
    setLoading(false);
  };

  const runPlan = async () => {
    setPlanning(true); setError("");
    try {
      await axios.post(`${API}/api/plan`, { handle: user.handle, days: Number(planDays) });
      onGoToPlan();
    } catch (e) { setError(e.response?.data?.error || "Error generating plan."); }
    setPlanning(false);
  };

  const radarData = analysis?.weakTopics.map(t => ({
    topic: t.topic.length > 12 ? t.topic.split(" ")[0] : t.topic,
    weakness: 100 - t.accuracy,
    accuracy: t.accuracy,
  })) || [];

  return (
    <div style={{ animation:"fadeIn .3s ease" }}>
      {/* Always show analyze controls at top */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: analysis ? 20 : 0 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:600, marginBottom:4 }}>
            {analysis ? "Analysis" : "Analyze with AI"}
          </h2>
          <p style={{ color:"#555", fontSize:13 }}>
            {analysis
              ? `Last analyzed: ${analysis.submissionsAnalyzed} submissions over ${lastAnalysisDays} days`
              : "Fetch your recent submissions and identify weak topics."}
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input type="text" inputmode = "numeric" value={days} onChange={e=>setDays(Math.max(1,Number(e.target.value)))}
            min={1} max={365}
            style={{ width:72, padding:"8px 10px", fontSize:13, background:"#111", border:"1px solid #222", borderRadius:8, color:"#fff", outline:"none", textAlign:"center" }}/>
          <span style={{ fontSize:12, color:"#555" }}>days</span>
          <button onClick={runAnalysis} disabled={loading}
            style={{ padding:"8px 18px", fontSize:13, fontWeight:600, background:loading?"#1a1a1a":"#6c47ff", color:"#fff", border:"none", borderRadius:8, cursor:loading?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8 }}>
            {loading ? <><span className="spinner"/>{analysis?"Re-analyzing...":"Analyzing..."}</> : analysis ? "Analyze again" : "Analyze →"}
          </button>
        </div>
      </div>

      {/* Live log */}
      {loading && log.length > 0 && (
        <div style={{ background:"#0d0d0d", border:"1px solid #1a1a1a", borderRadius:10, padding:"14px 16px", marginBottom:20, marginTop:16 }}>
          {log.map((l,i) => (
            <div key={i} style={{ fontSize:12, fontFamily:"monospace", color: l.startsWith("✓")?"#4ade80":"#555", marginBottom:4, animation:"fadeIn .3s ease" }}>
              <span style={{ color: l.startsWith("✓")?"#4ade80":"#6c47ff", marginRight:8 }}>{l.startsWith("✓")?"✓":"›"}</span>
              {l}
            </div>
          ))}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:8 }}>
            <span className="spin-sm"/>
            <span style={{ fontSize:11, color:"#333" }}>Working...</span>
          </div>
        </div>
      )}

      {error && <div style={{ padding:"10px 14px", background:"#1a0a0a", border:"1px solid #f87171", borderRadius:8, fontSize:13, color:"#f87171", marginBottom:16, marginTop:16 }}>{error}</div>}

      {!analysis && !loading && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"50vh", gap:12 }}>
          <div style={{ fontSize:48 }}>🧠</div>
          <p style={{ color:"#444", fontSize:14, textAlign:"center", maxWidth:360 }}>
            Enter the number of days above and click Analyze to get started.
          </p>
        </div>
      )}

      {analysis && !loading && (
        <>
          {/* Stats */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:20, marginTop:4 }}>
            {[
              { label:"Submissions",    value:analysis.submissionsAnalyzed },
              { label:"Weak topics",    value:analysis.weakTopics.length },
              { label:"Problems queued",value:analysis.priorityQueueSize },
              { label:"Unique problems",value:analysis.uniqueProblems||"—" },
            ].map(s=>(
              <div key={s.label} style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:10, padding:"14px 16px" }}>
                <div style={{ fontSize:22, fontWeight:600 }}>{s.value}</div>
                <div style={{ fontSize:12, color:"#555", marginTop:3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* AI summary */}
          <div style={{ background:"#111", border:"1px solid #1a1a2e", borderRadius:10, padding:"14px 18px", marginBottom:20 }}>
            <div style={{ fontSize:11, color:"#444", marginBottom:6, letterSpacing:1 }}>🤖 AI SUMMARY</div>
            <div style={{ fontSize:14, color:"#aaa", lineHeight:1.75 }}>{analysis.summary}</div>
          </div>

          {/* Charts */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:20 }}>
            <div style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:10, padding:"16px" }}>
              <div style={{ fontSize:12, color:"#555", marginBottom:12 }}>Weakness radar</div>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#1a1a1a"/>
                  <PolarAngleAxis dataKey="topic" tick={{ fill:"#555", fontSize:11 }}/>
                  <Radar dataKey="weakness" stroke="#6c47ff" fill="#6c47ff" fillOpacity={0.2}/>
                  <Tooltip contentStyle={{ background:"#111", border:"1px solid #222", borderRadius:8, fontSize:12 }} formatter={v=>[`${v}% weakness`]}/>
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:10, padding:"16px" }}>
              <div style={{ fontSize:12, color:"#555", marginBottom:12 }}>Accuracy by topic</div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={radarData} layout="vertical" margin={{ left:10 }}>
                  <XAxis type="number" domain={[0,100]} tick={{ fill:"#444", fontSize:10 }}/>
                  <YAxis type="category" dataKey="topic" tick={{ fill:"#666", fontSize:11 }} width={90}/>
                  <Tooltip contentStyle={{ background:"#111", border:"1px solid #222", borderRadius:8, fontSize:12 }} formatter={v=>[`${v}%`]}/>
                  <Bar dataKey="accuracy" radius={4}>
                    {radarData.map((d,i)=><Cell key={i} fill={d.accuracy<30?"#f87171":d.accuracy<50?"#fbbf24":"#4ade80"}/>)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weak topics */}
          <div style={{ fontSize:12, color:"#555", marginBottom:10 }}>Weak topics breakdown</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:28 }}>
            {analysis.weakTopics.map(t=>(
              <div key={t.topic} style={{ background:"#111", border:"1px solid #1a1a1a", borderRadius:10, padding:"12px 16px" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                  <span style={{ fontSize:14, fontWeight:500, textTransform:"capitalize" }}>{t.topic}</span>
                  <div style={{ display:"flex", gap:8, fontSize:12 }}>
                    <span style={{ color:"#888" }}>{t.solved}/{t.attempted} solved</span>
                    <span style={{ padding:"2px 8px", borderRadius:4, background:t.accuracy<30?"#2a0a0a":"#2a200a", color:t.accuracy<30?"#f87171":"#fbbf24" }}>{t.accuracy}%</span>
                  </div>
                </div>
                <div style={{ fontSize:12, color:"#555", marginBottom:8 }}>{t.reason}</div>
                <div style={{ height:3, background:"#1a1a1a", borderRadius:2, overflow:"hidden" }}>
                  <div style={{ height:3, width:`${t.accuracy}%`, background:t.accuracy<30?"#f87171":t.accuracy<50?"#fbbf24":"#4ade80", borderRadius:2, transition:"width .6s ease" }}/>
                </div>
              </div>
            ))}
          </div>

          {/* Generate plan CTA */}
          <div style={{ background:"#0d0d1a", border:"1px solid #1a1a2e", borderRadius:12, padding:"20px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <div>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>Ready to start practicing?</div>
              <div style={{ fontSize:13, color:"#555" }}>{analysis.priorityQueueSize} problems queued and scored by priority.</div>
            </div>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <input type="text" inputmode = "numeric" value={planDays} onChange={e=>setPlanDays(Math.max(1,Number(e.target.value)))}
                min={1} max={90}
                style={{ width:64, padding:"8px 10px", fontSize:13, background:"#111", border:"1px solid #222", borderRadius:8, color:"#fff", outline:"none", textAlign:"center" }}/>
              <span style={{ fontSize:12, color:"#555" }}>days</span>
              <button onClick={runPlan} disabled={planning}
                style={{ padding:"10px 20px", fontSize:14, fontWeight:600, background:planning?"#1a1a1a":"#6c47ff", color:"#fff", border:"none", borderRadius:8, cursor:planning?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8 }}>
                {planning ? <><span className="spinner"/>Building plan...</> : "Generate plan →"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}