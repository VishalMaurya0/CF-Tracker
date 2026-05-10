import { useState, useEffect } from "react";
import SetupScreen from "./components/SetupScreen";
import MainApp from "./components/MainApp";
import "./index.css";

const API = "http://localhost:3001";

export default function App() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // On mount — check localStorage for saved handle and reload from DB
  useEffect(() => {
    const saved = localStorage.getItem("cf_handle");
    if (!saved) { setLoading(false); return; }
    fetch(`${API}/api/profile?handle=${saved}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setUser({
            handle: data.settings.myHandle,
            practiceRating: data.settings.practiceRating,
            currentRating: data.settings.currentRating,
            friendHandles: data.settings.friendHandles || [],
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSetUser = (u) => {
    localStorage.setItem("cf_handle", u.handle);
    setUser(u);
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <span className="spinner" style={{ width:24, height:24, borderWidth:3 }}/>
    </div>
  );

  if (!user) return <SetupScreen API={API} onDone={handleSetUser} />;
  return <MainApp API={API} user={user} setUser={handleSetUser} />;
}