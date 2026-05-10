import { useState } from "react";
import axios from "axios";

export default function SetupScreen({ API, onDone }) {
  const [handle, setHandle]   = useState("");
  const [rating, setRating]   = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");


  const go = async () => {
  if (!handle.trim()) { setError("Enter your CF handle."); return; }
  setLoading(true); setError("");
  try {
    // First just validate the handle exists on CF
    const infoRes = await axios.get(
      `https://codeforces.com/api/user.info?handles=${handle.trim()}`
    );
    const cfUser = infoRes.data.result[0];

    // Save to our backend
    await axios.post(`${API}/api/setup`, {
      myHandle: handle.trim(),
      friendHandles: [],
      practiceRating: rating ? Number(rating) : cfUser.rating || 1200,
    });

    onDone({
      handle:        handle.trim(),
      practiceRating: rating ? Number(rating) : cfUser.rating || 1200,
      currentRating:  cfUser.rating || 0,
      friendHandles:  [],
    });
  } catch (e) {
    if (e.response?.data?.status === "FAILED") {
      setError("CF handle not found.");
    } else {
      setError(e.response?.data?.error || "CF handle not found. Check spelling.");
    }
  }
  setLoading(false);
};

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ width:420, animation:"fadeIn .4s ease" }}>
        <div style={{ fontSize:36, marginBottom:14 }}>⚡</div>
        <h1 style={{ fontSize:28, fontWeight:700, marginBottom:6 }}>CF Tracker</h1>
        <p style={{ color:"#555", fontSize:14, marginBottom:36 }}>AI-powered Codeforces practice tracker</p>

        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:12, color:"#555", display:"block", marginBottom:6 }}>Your Codeforces handle</label>
          <input value={handle} onChange={e=>setHandle(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&go()}
            placeholder="e.g. VishalMaurya0"
            style={{ width:"100%", padding:"11px 14px", fontSize:14, background:"#111", border:"1px solid #222", borderRadius:8, color:"#fff", outline:"none" }}/>
        </div>

        <div style={{ marginBottom:28 }}>
          <label style={{ fontSize:12, color:"#555", display:"block", marginBottom:6 }}>
            Practice rating
            <span style={{ color:"#333", marginLeft:6 }}>optional — leave blank to use your current CF rating</span>
          </label>
          <input value={rating} onChange={e=>setRating(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&go()}
            placeholder="e.g. 1400"
            type="number"
            style={{ width:"100%", padding:"11px 14px", fontSize:14, background:"#111", border:"1px solid #222", borderRadius:8, color:"#fff", outline:"none" }}/>
        </div>

        <button onClick={go} disabled={loading}
          style={{ width:"100%", padding:"13px", fontSize:15, fontWeight:600, background:loading?"#1a1a1a":"#6c47ff", color:"#fff", border:"none", borderRadius:10, cursor:loading?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
          {loading ? <><span className="spinner"/>Fetching your CF profile...</> : "Get started →"}
        </button>

        {error && (
          <div style={{ marginTop:16, padding:"10px 14px", background:"#1a0a0a", border:"1px solid #f87171", borderRadius:8, fontSize:13, color:"#f87171" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}