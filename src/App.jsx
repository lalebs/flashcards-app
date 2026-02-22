import { useState, useRef, useCallback, useEffect } from "react";

const SUPABASE_URL = "https://vkyzvgdtatovftqrdrdu.supabase.co";
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZreXp2Z2R0YXRvdmZ0cXJkcmR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NTM4NjIsImV4cCI6MjA4NzMyOTg2Mn0.zNLbsYNeZj26IRWmjLsVAy8NRy4py88Doj7pEkfeIjg";

const sbHeaders = {
  "apikey": SUPABASE_ANON,
  "Authorization": `Bearer ${SUPABASE_ANON}`,
  "Content-Type": "application/json",
};

function toApp(r) {
  return { id: r.id, question: r.question, answer: r.answer,
    category: r.category, n: r.n, interval: r.interval_days,
    ef: r.ef, nextDate: r.next_date, created: r.created };
}
function toDB(c) {
  return { id: c.id, question: c.question, answer: c.answer,
    category: c.category, n: c.n, interval_days: c.interval,
    ef: c.ef, next_date: c.nextDate, created: c.created };
}

async function dbLoad() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/flashcards?select=*&order=created.asc`, { headers: sbHeaders });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).map(toApp);
}
async function dbInsert(card) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/flashcards`, {
    method: "POST", headers: { ...sbHeaders, "Prefer": "return=minimal" },
    body: JSON.stringify(toDB(card))
  });
  if (!r.ok) throw new Error(await r.text());
}
async function dbUpdate(card) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/flashcards?id=eq.${card.id}`, {
    method: "PATCH", headers: { ...sbHeaders, "Prefer": "return=minimal" },
    body: JSON.stringify(toDB(card))
  });
  if (!r.ok) throw new Error(await r.text());
}
async function dbDelete(id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/flashcards?id=eq.${id}`, {
    method: "DELETE", headers: sbHeaders
  });
  if (!r.ok) throw new Error(await r.text());
}

// ── AI ────────────────────────────────────────────────────────────────────
async function callClaude(prompt, type = "score") {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/claude`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ prompt, type }),
    }
  );

  if (!res.ok) throw new Error(await res.text());

  const d = await res.json();
  return d.content?.map(b => b.text || "").join("") || "";
}

async function getCategories(cards) {
  if (!cards.length) return [];
  const list = cards.map((c, i) => `${i + 1}. Q: ${c.question}`).join("\n");
  const txt = await callClaude(`Tu es un expert en classification pédagogique. Voici des questions de flashcards :
${list}
Assigne une catégorie précise à chaque carte (sous-catégories si toutes similaires).
Retourne UNIQUEMENT un JSON valide sans markdown : [{"id":0,"category":"..."}]`, "categorize");
  try { return JSON.parse(txt.replace(/```json|```/g, "").trim()); }
  catch { return []; }
}

async function scoreAnswer(question, correctAnswer, userAnswer, timeMs) {
  const txt = await callClaude(`Correcteur pédagogique rigoureux.
Question: "${question}"
Réponse attendue: "${correctAnswer}"
Réponse étudiant: "${userAnswer}"
Temps: ${(timeMs / 1000).toFixed(1)}s
Règles : Score exactitude E (0-100). Dates/chiffres : écart >5% relatif → E≤35. Si E<60 : score_final=E. Si E≥60 : bonus(<10s→+8,<20s→+5,<40s→+2,sinon 0), score_final=min(100,E+bonus). correct=true si score_final≥75.
JSON sans markdown : {"score":0-100,"feedback":"max 15 mots","correct":boolean}`);
  try { return JSON.parse(txt.replace(/```json|```/g, "").trim()); }
  catch { return { score: 50, feedback: "Évaluation indisponible", correct: false }; }
}

// ── SRS ───────────────────────────────────────────────────────────────────
function calcNextDate(card, score) {
  const S = score / 100, EF = 1.3 + 1.7 * S * S;
  let { n = 0, interval = 1 } = card;
  const correct = score >= 75;
  let nextInterval;
  if (!correct) { nextInterval = 1; n = 0; }
  else { n += 1; nextInterval = n === 1 ? 1 : n === 2 ? 6 : Math.round(interval * EF); }
  const scheduled = card.nextDate ? new Date(card.nextDate) : new Date();
  const t = today();
  const base = scheduled > t ? scheduled : t;
  const next = new Date(base);
  next.setDate(next.getDate() + nextInterval);
  next.setHours(0, 0, 0, 0);
  return { n, interval: nextInterval, ef: EF, nextDate: next.toISOString() };
}

// ── Utils ─────────────────────────────────────────────────────────────────
const COLORS = ["#e07b54","#5b8dd9","#6abf69","#c77dff","#f6c90e","#f08080","#64b5f6","#81c784","#ffb74d","#ba68c8","#4db6ac","#ff8a65","#a1887f","#90a4ae","#e91e63"];
function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtDate(d) { return new Date(d).toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" }); }
function colorFor(cat, cats) { return COLORS[cats.indexOf(cat) % COLORS.length] || "#888"; }

// ── App ───────────────────────────────────────────────────────────────────
export default function App() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [creating, setCreating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editQ, setEditQ] = useState("");
  const [editA, setEditA] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [activeCard, setActiveCard] = useState(null);
  const [userAnswer, setUserAnswer] = useState("");
  const [timer, setTimer] = useState(0);
  const [result, setResult] = useState(null);
  const [scoring, setScoring] = useState(false);
  const timerRef = useRef(null);
  const startRef = useRef(null);

  const allCategories = [...new Set(cards.map(c => c.category).filter(Boolean))];
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i));

  function dueOn(day) {
    return cards.filter(c => {
      if (!c.nextDate) return false;
      const nd = new Date(c.nextDate); nd.setHours(0,0,0,0);
      const d2 = new Date(day); d2.setHours(0,0,0,0);
      return nd.getTime() === d2.getTime();
    });
  }

  useEffect(() => {
    dbLoad()
      .then(rows => { setCards(rows); setLoading(false); })
      .catch(e => { setDbError(e.message); setLoading(false); });
  }, []);

  const refreshCategories = useCallback(async (updatedCards) => {
    if (!updatedCards.length) return;
    const cats = await getCategories(updatedCards);
    const updates = [];
    setCards(prev => {
      const next = [...prev];
      cats.forEach(({ id, category }) => {
        const card = updatedCards[id]; if (!card) return;
        const idx = next.findIndex(c => c.id === card.id);
        if (idx !== -1 && next[idx].category !== category) {
          next[idx] = { ...next[idx], category };
          updates.push(next[idx]);
        }
      });
      return next;
    });
    await Promise.all(updates.map(c => dbUpdate(c).catch(console.error)));
  }, []);

  async function handleCreate() {
    if (!question.trim() || !answer.trim()) return;
    setCreating(true);
    const d = new Date(); d.setHours(0,0,0,0);
    const newCard = { id: Date.now(), question: question.trim(), answer: answer.trim(),
      category: "…", n: 0, interval: 1, ef: 2.5, nextDate: d.toISOString(), created: new Date().toISOString() };
    try {
      await dbInsert(newCard);
      const updated = [...cards, newCard];
      setCards(updated); setQuestion(""); setAnswer("");
      await refreshCategories(updated);
    } catch(e) { setDbError(e.message); }
    setCreating(false);
  }

  function startEdit(card) { setEditingId(card.id); setEditQ(card.question); setEditA(card.answer); }
  function cancelEdit() { setEditingId(null); setEditQ(""); setEditA(""); }

  async function saveEdit(card) {
    if (!editQ.trim() || !editA.trim()) return;
    setSaving(true);
    const updated = { ...card, question: editQ.trim(), answer: editA.trim() };
    try {
      await dbUpdate(updated);
      const updatedCards = cards.map(c => c.id === card.id ? updated : c);
      setCards(updatedCards); setEditingId(null);
      await refreshCategories(updatedCards);
    } catch(e) { setDbError(e.message); }
    setSaving(false);
  }

  async function deleteCard(id) {
    try { await dbDelete(id); setCards(prev => prev.filter(c => c.id !== id)); }
    catch(e) { setDbError(e.message); }
  }

  function openCard(card) {
    setActiveCard(card); setUserAnswer(""); setResult(null); setTimer(0);
    startRef.current = Date.now();
    timerRef.current = setInterval(() => setTimer(Math.floor((Date.now() - startRef.current) / 1000)), 200);
  }
  function closeReview() { clearInterval(timerRef.current); setActiveCard(null); setResult(null); }

  async function submitAnswer() {
    if (!userAnswer.trim() || scoring) return;
    clearInterval(timerRef.current);
    const elapsed = Date.now() - startRef.current;
    setScoring(true);
    const r = await scoreAnswer(activeCard.question, activeCard.answer, userAnswer, elapsed);
    setResult({ ...r, elapsed });
    const srs = calcNextDate(activeCard, r.score);
    const updated = { ...activeCard, ...srs };
    try { await dbUpdate(updated); } catch(e) { setDbError(e.message); }
    setCards(prev => prev.map(c => c.id === activeCard.id ? updated : c));
    setScoring(false);
  }

  const filteredCards = [...cards].reverse().filter(c =>
    !search || c.question.toLowerCase().includes(search.toLowerCase()) ||
    c.answer.toLowerCase().includes(search.toLowerCase()) ||
    (c.category || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ minHeight:"100vh", background:"#6b4c2a",
      backgroundImage:"radial-gradient(ellipse at 30% 20%,#7a5c35 0%,#4a3018 100%)",
      display:"flex", fontFamily:"'Georgia',serif", overflow:"hidden", position:"relative" }}>

      <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0,
        backgroundImage:"repeating-linear-gradient(92deg,transparent,transparent 120px,rgba(0,0,0,.04) 120px,rgba(0,0,0,.04) 121px),repeating-linear-gradient(2deg,transparent,transparent 80px,rgba(255,255,255,.02) 80px,rgba(255,255,255,.02) 81px)" }}/>

      {dbError && (
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:200, background:"#c0392b",
          color:"#fff", padding:"8px 16px", fontSize:13, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span>⚠️ Erreur Supabase : {dbError}</span>
          <button onClick={() => setDbError(null)} style={{ background:"none", border:"none", color:"#fff", cursor:"pointer", fontSize:16 }}>✕</button>
        </div>
      )}

      {/* LEFT */}
      <div style={{ width:340, minWidth:320, padding:"28px 20px", display:"flex",
        flexDirection:"column", gap:16, position:"relative", zIndex:1, borderRight:"2px solid rgba(0,0,0,.25)" }}>
        <h2 style={{ margin:0, color:"#f5e6c8", fontSize:18, letterSpacing:1, textShadow:"1px 1px 2px #0006" }}>✏️ Atelier de cartes</h2>

        <div style={{ background:"#fffde7", borderRadius:4, padding:16,
          boxShadow:"3px 3px 10px rgba(0,0,0,.4),inset 0 0 0 1px #e0d090", transform:"rotate(-1deg)", position:"relative" }}>
          <div style={{ fontSize:11, color:"#9e8a50", marginBottom:4, fontStyle:"italic" }}>RECTO — Question</div>
          <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Écris ta question ici…" rows={3}
            style={{ width:"100%", border:"none", background:"transparent", resize:"none", fontFamily:"'Georgia',serif", fontSize:14, color:"#3d2b00", outline:"none", lineHeight:1.6 }}/>
          <div style={{ borderTop:"1px dashed #d4b96a", margin:"8px 0" }}/>
          <div style={{ fontSize:11, color:"#9e8a50", marginBottom:4, fontStyle:"italic" }}>VERSO — Réponse</div>
          <textarea value={answer} onChange={e => setAnswer(e.target.value)} placeholder="La réponse…" rows={3}
            style={{ width:"100%", border:"none", background:"transparent", resize:"none", fontFamily:"'Georgia',serif", fontSize:14, color:"#3d2b00", outline:"none", lineHeight:1.6 }}/>
          <div style={{ position:"absolute", bottom:0, right:0, width:18, height:18,
            background:"linear-gradient(135deg,#f5e6b0 50%,#d4b050 50%)", borderRadius:"0 0 4px 0" }}/>
        </div>

        <button onClick={handleCreate} disabled={creating || !question.trim() || !answer.trim()}
          style={{ background:creating?"#a08040":"#c8a030", color:"#fff8e1", border:"none", borderRadius:4,
            padding:"10px 0", fontSize:14, cursor:"pointer", fontFamily:"'Georgia',serif", boxShadow:"2px 2px 6px rgba(0,0,0,.4)" }}>
          {creating ? "⏳ Ajout en cours…" : "＋ Ajouter la carte"}
        </button>

        {/* History */}
        <div style={{ background:"rgba(0,0,0,.2)", borderRadius:6, overflow:"hidden", border:"1px solid rgba(255,255,255,.08)" }}>
          <button onClick={() => setHistoryOpen(o => !o)}
            style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
              background:"rgba(0,0,0,.15)", border:"none", cursor:"pointer", padding:"9px 12px",
              color:"#f5e6c8", fontFamily:"'Georgia',serif", fontSize:13 }}>
            <span>📋 Historique des cartes
              {cards.length > 0 && <span style={{ marginLeft:8, background:"#c8a030", color:"#fff", borderRadius:10, padding:"1px 7px", fontSize:11 }}>{cards.length}</span>}
              {loading && <span style={{ marginLeft:8, fontSize:11, opacity:.7 }}>⏳</span>}
            </span>
            <span style={{ fontSize:12, opacity:.7, transform:historyOpen?"rotate(180deg)":"", transition:"transform .2s" }}>▼</span>
          </button>

          {historyOpen && (
            <div style={{ padding:"10px 10px 6px" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher…"
                style={{ width:"100%", boxSizing:"border-box", padding:"6px 10px", borderRadius:4, border:"1px solid #8a7040",
                  background:"#fffde7", fontFamily:"'Georgia',serif", fontSize:12, color:"#3d2b00", outline:"none", marginBottom:8 }}/>
              <div style={{ maxHeight:260, overflowY:"auto", display:"flex", flexDirection:"column", gap:6 }}>
                {filteredCards.length === 0 && (
                  <p style={{ color:"#c4a87a", fontSize:12, fontStyle:"italic", textAlign:"center", margin:"8px 0" }}>
                    {cards.length === 0 ? "Aucune carte créée." : "Aucun résultat."}
                  </p>
                )}
                {filteredCards.map(c => (
                  <div key={c.id} style={{ background:"#fffde7", borderRadius:3,
                    borderLeft:`4px solid ${colorFor(c.category, allCategories)}`,
                    boxShadow:"1px 1px 4px rgba(0,0,0,.25)", overflow:"hidden" }}>
                    {editingId === c.id ? (
                      <div style={{ padding:"8px 10px" }}>
                        <div style={{ fontSize:10, color:"#9e8a50", marginBottom:3, fontStyle:"italic" }}>RECTO</div>
                        <textarea value={editQ} onChange={e => setEditQ(e.target.value)} rows={2}
                          style={{ width:"100%", boxSizing:"border-box", border:"1px solid #d4b96a", borderRadius:3,
                            padding:"4px 6px", fontFamily:"'Georgia',serif", fontSize:12, color:"#3d2b00", background:"#fffff5", resize:"none", outline:"none" }}/>
                        <div style={{ fontSize:10, color:"#9e8a50", margin:"5px 0 3px", fontStyle:"italic" }}>VERSO</div>
                        <textarea value={editA} onChange={e => setEditA(e.target.value)} rows={2}
                          style={{ width:"100%", boxSizing:"border-box", border:"1px solid #d4b96a", borderRadius:3,
                            padding:"4px 6px", fontFamily:"'Georgia',serif", fontSize:12, color:"#3d2b00", background:"#fffff5", resize:"none", outline:"none" }}/>
                        <div style={{ display:"flex", gap:6, marginTop:6 }}>
                          <button onClick={() => saveEdit(c)} disabled={saving || !editQ.trim() || !editA.trim()}
                            style={{ flex:1, padding:"5px 0", background:"#6abf69", color:"#fff", border:"none", borderRadius:3, fontSize:11, cursor:"pointer", fontFamily:"'Georgia',serif" }}>
                            {saving ? "…" : "✓ Sauver"}</button>
                          <button onClick={cancelEdit}
                            style={{ flex:1, padding:"5px 0", background:"#ccc", color:"#444", border:"none", borderRadius:3, fontSize:11, cursor:"pointer", fontFamily:"'Georgia',serif" }}>
                            ✕ Annuler</button>
                        </div>
                      </div>
                    ) : confirmDeleteId === c.id ? (
                      <div style={{ padding:"8px 10px", background:"#fff0f0" }}>
                        <div style={{ fontSize:11, color:"#c0392b", marginBottom:7 }}>Supprimer cette carte définitivement ?</div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={() => { deleteCard(c.id); setConfirmDeleteId(null); }}
                            style={{ flex:1, padding:"5px 0", background:"#c0392b", color:"#fff", border:"none", borderRadius:3, fontSize:11, cursor:"pointer", fontFamily:"'Georgia',serif" }}>
                            ✕ Supprimer</button>
                          <button onClick={() => setConfirmDeleteId(null)}
                            style={{ flex:1, padding:"5px 0", background:"#ccc", color:"#444", border:"none", borderRadius:3, fontSize:11, cursor:"pointer", fontFamily:"'Georgia',serif" }}>
                            Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ padding:"7px 10px", display:"flex", alignItems:"flex-start", gap:6 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, color:"#3d2b00", fontWeight:"bold",
                            overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", marginBottom:2 }}>{c.question}</div>
                          <div style={{ display:"inline-block", fontSize:10, padding:"1px 6px", borderRadius:10,
                            background:colorFor(c.category, allCategories), color:"#fff", fontStyle:"italic" }}>{c.category}</div>
                        </div>
                        <div style={{ display:"flex", gap:4, flexShrink:0 }}>
                          <button onClick={() => startEdit(c)}
                            style={{ background:"none", border:"1px solid #d4b96a", borderRadius:3, padding:"3px 7px", cursor:"pointer", fontSize:11, color:"#8a6a20", fontFamily:"'Georgia',serif" }}
                            onMouseEnter={e => e.currentTarget.style.background="#f5e6b0"}
                            onMouseLeave={e => e.currentTarget.style.background="none"}>✎</button>
                          <button onClick={() => setConfirmDeleteId(c.id)}
                            style={{ background:"none", border:"1px solid #e8a0a0", borderRadius:3, padding:"3px 7px", cursor:"pointer", fontSize:11, color:"#c0392b", fontFamily:"'Georgia',serif" }}
                            onMouseEnter={e => e.currentTarget.style.background="#fde8e8"}
                            onMouseLeave={e => e.currentTarget.style.background="none"}>✕</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ flex:1, padding:"28px 16px", position:"relative", zIndex:1, overflowX:"auto" }}>
        <h2 style={{ margin:"0 0 16px", color:"#f5e6c8", fontSize:18, letterSpacing:1, textShadow:"1px 1px 2px #0006" }}>📅 Planning de révisions</h2>
        {loading && <div style={{ color:"#f5e6c8", fontStyle:"italic", fontSize:13, marginBottom:12 }}>⏳ Chargement depuis Supabase…</div>}
        <div style={{ background:"#f8f5e8", borderRadius:8, boxShadow:"4px 4px 20px rgba(0,0,0,.5)", overflow:"hidden", minHeight:460 }}>
          <div style={{ display:"flex", minHeight:460 }}>
            {days.map((day, i) => {
              const due = dueOn(day);
              return (
                <div key={i} style={{ flex:"1 1 0", minWidth:0, display:"flex", flexDirection:"column", borderRight:i<6?"1px solid #d6cdb0":"" }}>
                  <div style={{ background:i===0?"#4a90d9":"#6aaae8", padding:"7px 4px", textAlign:"center", borderBottom:"2px solid #2c6fad", flexShrink:0 }}>
                    <div style={{ color:"#fff", fontSize:11, fontWeight:"bold", lineHeight:1.3 }}>
                      {i===0?"Auj.":new Date(day).toLocaleDateString("fr-FR",{weekday:"short"})}
                    </div>
                    <div style={{ color:"rgba(255,255,255,.85)", fontSize:10 }}>
                      {new Date(day).toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}
                    </div>
                  </div>
                  <div style={{ flex:1, padding:"6px 3px", display:"flex", flexDirection:"column", gap:4, alignItems:"stretch", overflowY:"auto" }}>
                    {due.map(card => (
                      <div key={card.id} onClick={() => openCard(card)} title={card.category+" — "+card.question}
                        style={{ height:14, borderRadius:3, flexShrink:0, background:colorFor(card.category,allCategories),
                          cursor:"pointer", boxShadow:"0 1px 3px rgba(0,0,0,.35)", transition:"transform .15s" }}
                        onMouseEnter={e => { e.currentTarget.style.transform="scaleY(1.5)"; e.currentTarget.style.zIndex="10"; }}
                        onMouseLeave={e => { e.currentTarget.style.transform="scaleY(1)"; e.currentTarget.style.zIndex="1"; }}/>
                    ))}
                    {due.length===0 && <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", color:"#ccc", fontSize:16 }}>·</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop:16, display:"flex", gap:12, flexWrap:"wrap" }}>
          {allCategories.map(cat => (
            <div key={cat} style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(0,0,0,.25)", borderRadius:20, padding:"3px 10px" }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:colorFor(cat,allCategories) }}/>
              <span style={{ color:"#f5e6c8", fontSize:11 }}>{cat}</span>
              <span style={{ color:"#c4a87a", fontSize:11 }}>({cards.filter(c=>c.category===cat).length})</span>
            </div>
          ))}
        </div>
      </div>

      {/* REVIEW OVERLAY */}
      {activeCard && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.75)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:20 }}>
          <div style={{ background:"#fffde7", borderRadius:8, width:"100%", maxWidth:520, boxShadow:"0 20px 60px rgba(0,0,0,.6)", overflow:"hidden" }}>
            <div style={{ background:colorFor(activeCard.category,allCategories), padding:"12px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ color:"#fff", fontStyle:"italic", fontSize:13 }}>{activeCard.category}</span>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ color:"#fff", fontSize:14, fontWeight:"bold", background:"rgba(0,0,0,.2)", padding:"2px 10px", borderRadius:20 }}>
                  ⏱ {result ? (result.elapsed/1000).toFixed(1)+"s" : timer+"s"}
                </span>
                <button onClick={closeReview} style={{ background:"none", border:"none", color:"#fff", fontSize:20, cursor:"pointer" }}>✕</button>
              </div>
            </div>
            <div style={{ padding:"24px 28px" }}>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:11, color:"#9e8a50", marginBottom:6, letterSpacing:1 }}>QUESTION</div>
                <div style={{ fontSize:17, color:"#3d2b00", lineHeight:1.6 }}>{activeCard.question}</div>
              </div>
              {!result ? (
                <>
                  <div style={{ fontSize:11, color:"#9e8a50", marginBottom:6, letterSpacing:1 }}>TA RÉPONSE</div>
                  <textarea autoFocus value={userAnswer} onChange={e => setUserAnswer(e.target.value)}
                    onKeyDown={e => { if(e.key==="Enter" && e.ctrlKey) submitAnswer(); }}
                    placeholder="Tape ta réponse… (Ctrl+Entrée pour valider)" rows={3}
                    style={{ width:"100%", border:"1px solid #d4b96a", borderRadius:4, padding:10, fontFamily:"'Georgia',serif",
                      fontSize:14, color:"#3d2b00", background:"#fffef5", outline:"none", resize:"none", lineHeight:1.5, boxSizing:"border-box" }}/>
                  <button onClick={submitAnswer} disabled={scoring || !userAnswer.trim()}
                    style={{ marginTop:12, width:"100%", padding:"10px 0", background:scoring?"#b8a060":"#c8a030",
                      color:"#fff8e1", border:"none", borderRadius:4, fontSize:14, cursor:"pointer", fontFamily:"'Georgia',serif" }}>
                    {scoring ? "⏳ Correction en cours…" : "Valider ma réponse"}
                  </button>
                </>
              ) : (
                <>
                  <div style={{ marginBottom:16 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:13, color:"#3d2b00", fontWeight:"bold" }}>Score</span>
                      <span style={{ fontSize:18, fontWeight:"bold", color:result.score>=75?"#2e7d32":result.score>=50?"#f57c00":"#c62828" }}>{result.score}%</span>
                    </div>
                    <div style={{ background:"#e0d8c0", borderRadius:10, height:10, overflow:"hidden" }}>
                      <div style={{ width:`${result.score}%`, height:"100%", borderRadius:10,
                        background:result.score>=75?"#4caf50":result.score>=50?"#ff9800":"#f44336", transition:"width .6s ease" }}/>
                    </div>
                    <p style={{ margin:"8px 0 0", fontSize:13, color:"#6d5030", fontStyle:"italic" }}>{result.feedback}</p>
                  </div>
                  <div style={{ background:"#f0f8f0", border:"1px solid #a5d6a7", borderRadius:4, padding:"10px 14px", marginBottom:16 }}>
                    <div style={{ fontSize:11, color:"#558b2f", marginBottom:4, letterSpacing:1 }}>RÉPONSE CORRECTE</div>
                    <div style={{ fontSize:14, color:"#2e4a1e" }}>{activeCard.answer}</div>
                  </div>
                  <div style={{ fontSize:12, color:"#9e8a50", textAlign:"center", fontStyle:"italic", marginBottom:12 }}>
                    Prochaine révision : {fmtDate(new Date(cards.find(c => c.id===activeCard.id)?.nextDate || ""))}
                  </div>
                  <button onClick={closeReview} style={{ width:"100%", padding:"10px 0", background:"#4a90d9", color:"#fff",
                    border:"none", borderRadius:4, fontSize:14, cursor:"pointer", fontFamily:"'Georgia',serif" }}>Fermer</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
