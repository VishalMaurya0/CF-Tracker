import { useState } from "react";
import axios from "axios";

export default function TopBar({ user, setUser, API, section, setSection, analysisReady }) {
  const [friendInput, setFriendInput] = useState("");
  const [friends, setFriends]         = useState(user.friendHandles || []);
  const [adding, setAdding]           = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [friendErr, setFriendErr]     = useState("");

  const addFriend = async () => {
    const h = friendInput.trim();
    if (!h || friends.includes(h)) { setFriendErr("Already added or empty."); return; }
    setAdding(true); setFriendErr("");
    try {
      await axios.post(`${API}/api/setup`, {
        myHandle: user.handle,
        friendHandles: [...friends, h],
        practiceRating: user.practiceRating,
      });
      const newFriends = [...friends, h];
      setFriends(newFriends);
      setUser({ ...user, friendHandles: newFriends });
      setFriendInput("");
    } catch (e) { setFriendErr(e.response?.data?.error || "Invalid handle."); }
    setAdding(false);
  };

  const TABS = [
    { id:"analyze", label:"Analyze" },
    { id:"plan",    label:"Plan",    disabled:!analysisReady },
    { id:"backlog", label:"Backlog" },
  ];

  return (
    <div style={{ borderBottom:"1px solid #141414", padding:"0 24px", height:52, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"#0a0a0a", zIndex:100 }}>
      {/* Left: logo + tabs */}
      <div style={{ display:"flex", alignItems:"center", gap:24 }}>
        <span style={{ fontWeight:700, fontSize:15, color:"#fff" }}>⚡ CF Tracker</span>
        <div style={{ display:"flex", gap:2 }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>!t.disabled&&setSection(t.id)} disabled={t.disabled}
              style={{ padding:"5px 14px", fontSize:13, borderRadius:6, border:"none", background:section===t.id?"#1a1a2e":"transparent", color:t.disabled?"#333":section===t.id?"#6c47ff":"#666", cursor:t.disabled?"not-allowed":"pointer", fontWeight:section===t.id?600:400 }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right */}
      <div style={{ display:"flex", alignItems:"center", gap:16, position:"relative" }}>
        {/* Ratings — only show if values exist */}
        <div style={{ fontSize:12, display:"flex", gap:16 }}>
          {user.currentRating ? (
            <span style={{ color:"#555" }}>
              Rating: <span style={{ color:"#a78bfa", fontWeight:600 }}>{user.currentRating}</span>
            </span>
          ) : null}
          {user.practiceRating ? (
            <span style={{ color:"#555" }}>
              Practice: <span style={{ color:"#6c47ff", fontWeight:600 }}>{user.practiceRating}</span>
            </span>
          ) : null}
        </div>

        {/* Handle button */}
        <button onClick={()=>setShowFriends(!showFriends)}
          style={{ padding:"5px 12px", fontSize:13, background:"#111", border:"1px solid #222", borderRadius:8, color:"#ccc", cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          @{user.handle}
          <span style={{ fontSize:10, color:"#555" }}>▼</span>
          {friends.length>0 && (
            <span style={{ fontSize:10, background:"#1a1a2e", color:"#6c47ff", padding:"1px 6px", borderRadius:10 }}>
              {friends.length}
            </span>
          )}
        </button>

        {/* Friends dropdown */}
        {showFriends && (
          <div style={{ position:"absolute", top:42, right:0, width:270, background:"#111", border:"1px solid #222", borderRadius:10, padding:"14px", zIndex:200, animation:"fadeIn .2s ease", boxShadow:"0 8px 32px #000a" }}>
            <div style={{ fontSize:11, color:"#555", marginBottom:10, letterSpacing:1 }}>FRIENDS</div>
            <div style={{ maxHeight:150, overflowY:"auto", marginBottom:12 }}>
              {friends.length===0 ? (
                <div style={{ fontSize:12, color:"#333", padding:"6px 0" }}>No friends added yet.</div>
              ) : friends.map(f=>(
                <div key={f} style={{ fontSize:13, color:"#888", padding:"5px 0", borderBottom:"1px solid #1a1a1a", display:"flex", alignItems:"center", gap:6 }}>
                  <span style={{ color:"#444", fontSize:11 }}>@</span>{f}
                </div>
              ))}
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <input value={friendInput} onChange={e=>setFriendInput(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&addFriend()}
                placeholder="Add CF handle"
                style={{ flex:1, padding:"7px 10px", fontSize:12, background:"#0a0a0a", border:"1px solid #222", borderRadius:6, color:"#fff", outline:"none" }}/>
              <button onClick={addFriend} disabled={adding}
                style={{ padding:"7px 12px", fontSize:13, background:"#6c47ff", color:"#fff", border:"none", borderRadius:6, cursor:adding?"not-allowed":"pointer", display:"flex", alignItems:"center" }}>
                {adding ? <span className="spin-sm"/> : "+"}
              </button>
            </div>
            {friendErr && <div style={{ fontSize:11, color:"#f87171", marginTop:8 }}>{friendErr}</div>}
          </div>
        )}
      </div>
    </div>
  );
}