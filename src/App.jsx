import { useEffect, useState } from "react";

const SUPABASE_URL = "https://vkyzvgdtatovftqrdrdu.supabase.co";
const SUPABASE_ANON = "TA_CLE_ANON_ICI";

const sbHeaders = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  "Content-Type": "application/json",
};

async function dbLoad() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/flashcards?select=*&order=created.asc`,
    { headers: sbHeaders }
  );
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function dbInsert(card) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/flashcards`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify(card),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function callClaude(prompt) {
  const r = await fetch(
    `${SUPABASE_URL}/functions/v1/claude`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ prompt }),
    }
  );

  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return d.content?.map((b) => b.text || "").join("") || "";
}

export default function App() {
  const [cards, setCards] = useState([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dbLoad()
      .then(setCards)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function addCard() {
    if (!question.trim() || !answer.trim()) return;

    const card = {
      id: Date.now(),
      question,
      answer,
      category: "temp",
      n: 0,
      interval_days: 1,
      ef: 2.5,
      next_date: new Date().toISOString(),
      created: new Date().toISOString(),
    };

    try {
      await dbInsert(card);
      setCards((prev) => [...prev, card]);
      setQuestion("");
      setAnswer("");
    } catch (e) {
      alert(e.message);
    }
  }

  async function testAI() {
    const res = await callClaude("Réponds seulement: OK");
    alert(res);
  }

  if (loading) return <div style={{ padding: 20 }}>Chargement…</div>;

  return (
    <div style={{ padding: 40, fontFamily: "sans-serif" }}>
      <h1>Flashcards</h1>

      <div style={{ marginBottom: 20 }}>
        <input
          placeholder="Question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          style={{ display: "block", marginBottom: 10 }}
        />
        <input
          placeholder="Réponse"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          style={{ display: "block", marginBottom: 10 }}
        />
        <button onClick={addCard}>Ajouter</button>
        <button onClick={testAI} style={{ marginLeft: 10 }}>
          Test IA
        </button>
      </div>

      <ul>
        {cards.map((c) => (
          <li key={c.id}>{c.question}</li>
        ))}
      </ul>
    </div>
  );
}
