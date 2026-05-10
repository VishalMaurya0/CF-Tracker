import { useState } from "react";
import axios from "axios";

export default function GoalScreen({ onDone }) {
  const [goal, setGoal] = useState("Prepare me for placements in 30 days");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");

  const LOG_STEPS = [
    "🔌 Connecting to MongoDB...",
    "📂 Fetching your coding history...",
    "🧠 Analyzing weak topics...",
    "📅 Generating 30-day plan...",
    "💾 Saving plan to database...",
    "✅ Plan ready!",
  ];

  const runAgent = async () => {
    setLoading(true);
    setLog([]);
    setError("");

    // Simulate agent log steps while real call runs
    let i = 0;
    const interval = setInterval(() => {
      if (i < LOG_STEPS.length - 1) {
        setLog((prev) => [...prev, LOG_STEPS[i++]]);
      }
    }, 600);

    try {
      const res = await axios.post("http://localhost:3000/agent", { goal });
      clearInterval(interval);
      setLog(LOG_STEPS); // show all steps done
      setTimeout(() => onDone(res.data), 800);
    } catch (err) {
      clearInterval(interval);
      setError(err.response?.data?.error || "Something went wrong. Is your server running?");
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "80px 24px" }}>
      {/* Logo */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🧠</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>PrepPilot AI</h1>
        <p style={{ color: "#888", marginTop: 8, fontSize: 15 }}>
          Your autonomous coding interview agent
        </p>
      </div>

      {/* Goal input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, color: "#888", display: "block", marginBottom: 8 }}>
          What's your goal?
        </label>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={loading}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 15,
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 10,
            color: "#fff",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Run button */}
      <button
        onClick={runAgent}
        disabled={loading || !goal.trim()}
        style={{
          width: "100%",
          padding: "13px",
          fontSize: 15,
          fontWeight: 600,
          background: loading ? "#333" : "#6c47ff",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "background 0.2s",
        }}
      >
        {loading ? "Agent running..." : "Run Agent ↗"}
      </button>

      {/* Agent log */}
      {log.length > 0 && (
        <div
          style={{
            marginTop: 24,
            background: "#1a1a1a",
            border: "1px solid #222",
            borderRadius: 10,
            padding: "16px",
          }}
        >
          {log.map((entry, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                fontFamily: "monospace",
                color: "#aaa",
                marginBottom: 6,
                animation: "fadeIn 0.3s ease",
              }}
            >
              {entry}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 16px",
            background: "#2a1a1a",
            border: "1px solid #f87171",
            borderRadius: 10,
            fontSize: 13,
            color: "#f87171",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}