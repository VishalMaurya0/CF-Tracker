import { useState } from "react";
import GoalScreen from "./components/GoalScreen";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [screen, setScreen] = useState("goal"); // "goal" | "dashboard"
  const [agentData, setAgentData] = useState(null);

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f0f", color: "#fff", fontFamily: "system-ui" }}>
      {screen === "goal" ? (
        <GoalScreen
          onDone={(data) => {
            setAgentData(data);
            setScreen("dashboard");
          }}
        />
      ) : (
        <Dashboard data={agentData} onReset={() => setScreen("goal")} />
      )}
    </div>
  );
}