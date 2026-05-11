import { useState, useEffect } from "react";
import axios from "axios";
import TopBar from "./TopBar";
import AnalyzePanel from "./AnalyzePanel";
import PlanPanel from "./PlanPanel";
import BacklogPanel from "./BacklogPanel";

export default function MainApp({ API, user, setUser, onLogout }) {
  const [section, setSection]                   = useState("analyze");
  const [analysis, setAnalysis]                 = useState(null);
  const [plan, setPlan]                         = useState(null);
  const [hasBacklogAdditions, setHasBacklogAdditions] = useState(false);
  const [todoState, setTodoState]               = useState({});
  const [loadingSession, setLoadingSession]     = useState(true);

  // Load saved plan + progress on mount
  useEffect(() => {
    const loadSession = async () => {
      try {
        // Load saved plan from DB
        const profileRes = await axios.get(`${API}/api/profile?handle=${user.handle}`);
        if (profileRes.data.plans && profileRes.data.plans.length > 0) {
          // Reconstruct plan shape
          const plans = profileRes.data.plans;
          setPlan({
            totalDays: plans.length,
            problemsPerDay: plans[0]?.todos?.length || 0,
            totalProblems: plans.reduce((acc, d) => acc + (d.todos?.length || 0), 0),
            plan: plans.map(d => ({
              day: d.day,
              date: d.date,
              focus: [...new Set(d.todos.map(t => t.topic))].join(" + "),
              problemCount: d.todos.length,
              problems: d.todos.map(t => ({
                contestId: t.contestId,
                index: t.index,
                name: t.name,
                rating: t.rating,
                topic: t.topic,
                url: t.url,
              })),
            })),
          });
        }

        // Load saved progress states
        const progressRes = await axios.get(`${API}/api/progress/load?handle=${user.handle}`);
        if (progressRes.data.states) {
          setTodoState(progressRes.data.states);
        }

        // Load saved analysis from localStorage
        const savedAnalysis = localStorage.getItem(`cf_analysis_${user.handle}`);
        if (savedAnalysis) setAnalysis(JSON.parse(savedAnalysis));

      } catch (e) { console.log("Session load error:", e.message); }
      setLoadingSession(false);
    };
    loadSession();
  }, [user.handle]);




  // Save analysis to localStorage whenever it changes
  const handleSetAnalysis = (data) => {
    setAnalysis(data);
    if (data) localStorage.setItem(`cf_analysis_${user.handle}`, JSON.stringify(data));
  };

  if (loadingSession) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
      <span className="spinner" style={{ width:24, height:24, borderWidth:3 }}/>
      <span style={{ fontSize:13, color:"#444" }}>Loading your session...</span>
    </div>
  );






  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <TopBar
        user={user} setUser={setUser} API={API}
        section={section} setSection={setSection}
        analysisReady={!!analysis}
        onLogout={onLogout}   
      />
      <div style={{ flex:1, padding:"24px", maxWidth:1100, margin:"0 auto", width:"100%", animation:"fadeIn .3s ease" }}>
        {section==="analyze" && (
          <AnalyzePanel
            API={API} user={user}
            analysis={analysis} setAnalysis={handleSetAnalysis}
            onGoToPlan={() => { setPlan(null); setSection("plan"); }}
          />
        )}
        {section==="plan" && (
          <PlanPanel
            API={API} user={user}
            plan={plan} setPlan={setPlan}
            todoState={todoState} setTodoState={setTodoState}
            hasBacklogAdditions={hasBacklogAdditions}
            setHasBacklogAdditions={setHasBacklogAdditions}
          />
        )}
        {section==="backlog" && (
          <BacklogPanel
            API={API} user={user}
            onAddedToQueue={() => setHasBacklogAdditions(true)}
          />
        )}
      </div>
    </div>
  );
}