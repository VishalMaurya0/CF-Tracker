import { useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip,
} from "recharts";

export default function Dashboard({ data, onReset }) {
  const { goal, weakTopics, plan, response } = data;
  const days = plan?.plan || [];
  const [done, setDone] = useState({});

  const toggleTask = (dayIdx, taskIdx) => {
    const key = `${dayIdx}-${taskIdx}`;
    setDone((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const totalTasks = days.reduce((acc, d) => acc + d.tasks.length, 0);
  const doneTasks = Object.values(done).filter(Boolean).length;
  const pct = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Radar chart data — invert accuracy so higher bar = weaker topic
  const radarData = weakTopics.map((t) => ({
    topic: t.topic.split(" ")[0], // short name
    weakness: 100 - t.accuracy,
  }));

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <div style={{ fontSize: 22, marginBottom: 4 }}>🧠 PrepPilot</div>
          <div style={{ fontSize: 13, color: "#666" }}>{goal}</div>
        </div>
        <button
          onClick={onReset}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            background: "transparent",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#888",
            cursor: "pointer",
          }}
        >
          New goal
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Days in plan", value: plan?.totalDays || 30 },
          { label: "Tasks done", value: `${doneTasks} / ${totalTasks}` },
          { label: "Progress", value: `${pct}%` },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "#1a1a1a",
              border: "1px solid #222",
              borderRadius: 10,
              padding: "16px",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 600 }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ height: 6, background: "#222", borderRadius: 3, marginBottom: 28, overflow: "hidden" }}>
        <div
          style={{
            height: 6,
            width: `${pct}%`,
            background: "#6c47ff",
            borderRadius: 3,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* AI Summary */}
      <div
        style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 28,
          fontSize: 14,
          color: "#bbb",
          lineHeight: 1.7,
        }}
      >
        <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>🤖 Agent summary</div>
        {response}
      </div>

      {/* Weak topics radar */}
      {radarData.length > 0 && (
        <div
          style={{
            background: "#1a1a1a",
            border: "1px solid #222",
            borderRadius: 10,
            padding: "20px",
            marginBottom: 28,
          }}
        >
          <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Weak topic map</div>
          <ResponsiveContainer width="100%" height={220}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#333" />
              <PolarAngleAxis dataKey="topic" tick={{ fill: "#888", fontSize: 12 }} />
              <Radar dataKey="weakness" stroke="#6c47ff" fill="#6c47ff" fillOpacity={0.25} />
              <Tooltip
                contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }}
                formatter={(v) => [`${v}% weakness`, ""]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Task list */}
      <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Your plan</div>
      {days.map((day, di) => (
        <div
          key={di}
          style={{
            background: "#1a1a1a",
            border: "1px solid #222",
            borderRadius: 10,
            padding: "16px 20px",
            marginBottom: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <span style={{ fontSize: 12, color: "#555" }}>Day {day.day} · </span>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{day.focus}</span>
            </div>
            <span
              style={{
                fontSize: 11,
                padding: "2px 10px",
                borderRadius: 20,
                background: day.accuracy < 40 ? "#2a1a1a" : day.accuracy < 60 ? "#2a2210" : "#1a2a1a",
                color: day.accuracy < 40 ? "#f87171" : day.accuracy < 60 ? "#fbbf24" : "#4ade80",
              }}
            >
              {day.accuracy}% accuracy
            </span>
          </div>
          {day.tasks.map((task, ti) => {
            const key = `${di}-${ti}`;
            const isDone = done[key];
            return (
              <div
                key={ti}
                onClick={() => toggleTask(di, ti)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  cursor: "pointer",
                  borderTop: ti > 0 ? "1px solid #222" : "none",
                  opacity: isDone ? 0.45 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `1px solid ${isDone ? "#6c47ff" : "#444"}`,
                    background: isDone ? "#6c47ff" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    fontSize: 11,
                  }}
                >
                  {isDone ? "✓" : ""}
                </div>
                <span
                  style={{
                    fontSize: 13,
                    color: "#ccc",
                    textDecoration: isDone ? "line-through" : "none",
                  }}
                >
                  {task}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}