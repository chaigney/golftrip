import React, { useMemo, useState, useRef } from "react";

// Golf Trip Mini App — Canvas-safe React (no localStorage)
// New: unique players per team, max 2 players per team; multiple matches with per‑match modes;
// combined Scorecard+Matchboard per match: "Scorecard — <Course> — <Team A> vs <Team B>".
// Team selection prevents duplicates and self‑matches; totals only after complete holes.
// Hole backgrounds by PAR (grayscale). Number colors reflect score vs PAR.

// ----- Course data (PAR per hole) -----
const COURSES = [
  { key: "hiawatha", name: "The Links at Hiawatha Landing", par: [4,4,3,4,4,3,5,4,5, 4,4,5,3,4,4,3,5,4] },
  { key: "enjoie",   name: "En‑Joie Golf Club",             par: [4,4,5,3,5,4,3,5,4, 4,4,5,4,3,4,4,3,4] },
  { key: "conklin",  name: "Conklin Players Club",          par: [4,3,4,4,4,5,3,4,5, 3,4,4,3,5,4,4,4,5] },
];

// Neutral backgrounds for holes by PAR
function holeBgForPar(par) {
  if (par === 3) return "#f5f5f5";   // light gray
  if (par === 4) return "#ffffff";   // white
  if (par === 5) return "#e5e7eb";   // gray-200
  return "#ffffff";
}

// Text color for a stroke relative to PAR
function colorForRelative(score, par) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "#000000";
  const d = n - par; // negative = under par
  if (d <= -3) return "#6d28d9";   // albatross+
  if (d === -2) return "#0891b2";  // eagle
  if (d === -1) return "#16a34a";  // birdie
  if (d === 0)  return "#000000";  // par
  if (d === 1)  return "#f59e0b";  // bogey
  if (d === 2)  return "#ef4444";  // double
  return "#991b1b";                 // triple+
}

// Game modes
const MODES = [
  { id: "bestball",    name: "Best Ball (1 pt)", desc: "Lower of two scores per team; lower best ball earns 1; ties split 0.5." },
  { id: "highlow",     name: "High–Low (2 pts)", desc: "LOW vs LOW (1), HIGH vs HIGH (1); ties split." },
  { id: "captainmate", name: "Captain & Mate (2 pts)", desc: "First listed player treated as captain; compare captain (1) and mate (1)." },
  { id: "aggregate",   name: "Aggregate (1 pt)", desc: "Sum both scores; lower total earns 1; ties split." },
  { id: "stableford",  name: "Stableford (1 pt)", desc: "DB0 B1 P2 Brd3 Eg4 Alb5 per player; team sum vs team sum; 1 for higher; ties 0.5." },
  { id: "skins",       name: "Skins (carry)", desc: "Lower best ball wins; ties carry to the next hole. Winner earns carry+1 when a hole is won." },
];

function uid() { return Math.random().toString(36).slice(2, 9); }
const empty18 = () => Array.from({ length: 18 }, () => "");

export default function App() {
  // Core state
  const [players, setPlayers] = useState([]);              // {id,name}
  const [teams, setTeams] = useState([]);                  // {id,name,playerIds:[pid0,pid1]}
  const [matches, setMatches] = useState([]);              // {id, teamAId, teamBId, mode}
  const [courseKey, setCourseKey] = useState(COURSES[0].key);
  const [scoresByCourse, setScoresByCourse] = useState({ hiawatha: {}, enjoie: {}, conklin: {} });

  const course = COURSES.find((c) => c.key === courseKey) || COURSES[0];
  const parArr = course.par;

  // --- Helpers: assignments ---
  const assignedPlayerIds = useMemo(() => new Set(teams.flatMap(t => (t.playerIds || []).filter(Boolean))), [teams]);

  const addPlayer = (name = "") => {
    const p = { id: uid(), name: name || `Player ${players.length + 1}` };
    setPlayers((arr) => [...arr, p]);
    setScoresByCourse((prev) => ({ ...prev, [courseKey]: { ...(prev[courseKey] || {}), [p.id]: empty18() } }));
  };
  const renamePlayer = (id, name) => setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)));
  const removePlayer = (id) => {
    setPlayers((ps) => ps.filter((p) => p.id !== id));
    // remove from teams
    setTeams((ts) => ts.map((t) => ({ ...t, playerIds: (t.playerIds || []).map((pid) => (pid === id ? "" : pid)) })));
    // cleanup scores (current course only)
    setScoresByCourse((prev) => { const next = { ...prev }; const m = { ...(next[courseKey] || {}) }; delete m[id]; next[courseKey] = m; return next; });
  };

  const addTeam = () => setTeams((ts) => [...ts, { id: uid(), name: `Team ${ts.length + 1}`, playerIds: ["", ""] }]);
  const setTeamName = (id, name) => setTeams((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)));

  // Unique assignment: move player to (team,slot) and remove from any previous team
  const assignPlayer = (teamId, slotIdx, newPid) => {
    setTeams((ts) => {
      // If clearing
      if (!newPid) {
        return ts.map((t) => t.id === teamId ? { ...t, playerIds: Object.assign([], t.playerIds, { [slotIdx]: "" }) } : t);
      }
      // Remove newPid from any other team first
      const cleared = ts.map((t) => ({ ...t, playerIds: (t.playerIds || []).map((pid) => (pid === newPid ? "" : pid)) }));
      // Set in target team/slot
      return cleared.map((t) => (
        t.id === teamId ? { ...t, playerIds: Object.assign([], t.playerIds, { [slotIdx]: newPid }) } : t
      ));
    });
  };

  const removeTeam = (id) => {
    setTeams((ts) => ts.filter((t) => t.id !== id));
    // Also remove this team from any matches
    setMatches((ms) => ms.filter((m) => m.teamAId !== id && m.teamBId !== id));
  };

  const autoPair = () => {
    const freeIds = players.map(p => p.id);
    const pairs = [];
    for (let i = 0; i < freeIds.length; i += 2) pairs.push(freeIds.slice(i, i + 2));
    setTeams(pairs.map((pair, idx) => ({ id: uid(), name: `Team ${idx + 1}`, playerIds: [pair[0] || "", pair[1] || ""] })));
  };

  // Scores
  const ensurePlayerScores = (pid) => setScoresByCourse((prev) => { const m = prev[courseKey] || {}; if (!m[pid]) return { ...prev, [courseKey]: { ...m, [pid]: empty18() } }; return prev; });
  const setScore = (pid, holeIdx, value) => { ensurePlayerScores(pid); setScoresByCourse((prev) => { const m = { ...(prev[courseKey] || {}) }; const arr = m[pid] ? [...m[pid]] : empty18(); arr[holeIdx] = value; m[pid] = arr; return { ...prev, [courseKey]: m }; }); };

  const playerTotals = useMemo(() => {
    const res = {}; const m = scoresByCourse[courseKey] || {};
    for (const p of players) { const arr = m[p.id] || empty18(); res[p.id] = arr.reduce((s, v) => s + (Number(v) || 0), 0); }
    return res;
  }, [players, scoresByCourse, courseKey]);

  // --- Matches ---
  const teamsInAnyMatch = useMemo(() => new Set(matches.flatMap(m => [m.teamAId, m.teamBId].filter(Boolean))), [matches]);

  const addMatch = () => setMatches((ms) => [...ms, { id: uid(), teamAId: "", teamBId: "", mode: MODES[0].id }]);
  const removeMatch = (mid) => setMatches((ms) => ms.filter((m) => m.id !== mid));
  const setMatchField = (mid, field, value) => setMatches((ms) => ms.map((m) => (m.id === mid ? { ...m, [field]: value } : m)));

  // Save/Load matches (JSON export/import)
  const matchesFileInputRef = useRef(null);
  const exportMatches = () => {
    const data = { players, teams, matches };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'golf-matches.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };
  const handleMatchesFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const { players: p, teams: t, matches: ms } = data || {};
        if (Array.isArray(p)) setPlayers(p);
        if (Array.isArray(t)) setTeams(t);
        if (Array.isArray(ms)) setMatches(ms);
      } catch (err) {
        alert('Invalid matches JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // --- Scoring ---
  const teamById = (id) => teams.find((t) => t.id === id);
  const getScore = (pid, h) => { const v = (scoresByCourse[courseKey] || {})[pid]?.[h]; if (v === "" || v === null || v === undefined) return NaN; const n = Number(v); return Number.isFinite(n) ? n : NaN; };

  function computeHole(modeId, h, A, B) {
    if (!A || !B) return { aPts: 0, bPts: 0, info: "Pick two teams", complete: false };
    const [a1, a2] = A.playerIds || [], [b1, b2] = B.playerIds || [];
    if (!a1 || !a2 || !b1 || !b2) return { aPts: 0, bPts: 0, info: "Both teams need two players", complete: false };
    const aS = [getScore(a1, h), getScore(a2, h)], bS = [getScore(b1, h), getScore(b2, h)];
    if (aS.some(Number.isNaN) || bS.some(Number.isNaN)) return { aPts: 0, bPts: 0, info: "Waiting for scores", complete: false };

    const tie = 0.5;
    if (modeId === "bestball") {
      const aBest = Math.min(...aS), bBest = Math.min(...bS);
      if (aBest < bBest) return { aPts: 1, bPts: 0, info: `A best ${aBest} beats ${bBest}`, complete: true };
      if (bBest < aBest) return { aPts: 0, bPts: 1, info: `B best ${bBest} beats ${aBest}`, complete: true };
      return { aPts: tie, bPts: tie, info: "Push", complete: true };
    }
    if (modeId === "aggregate") {
      const aTot = aS[0] + aS[1], bTot = bS[0] + bS[1];
      if (aTot < bTot) return { aPts: 1, bPts: 0, info: `A ${aTot} vs ${bTot}`, complete: true };
      if (bTot < aTot) return { aPts: 0, bPts: 1, info: `B ${bTot} vs ${aTot}`, complete: true };
      return { aPts: tie, bPts: tie, info: "Push", complete: true };
    }
    if (modeId === "highlow") {
      let aPts = 0, bPts = 0; const aLow = Math.min(...aS), aHigh = Math.max(...aS), bLow = Math.min(...bS), bHigh = Math.max(...bS);
      if (aLow < bLow) aPts += 1; else if (bLow < aLow) bPts += 1; else { aPts += tie; bPts += tie; }
      if (aHigh < bHigh) aPts += 1; else if (bHigh < aHigh) bPts += 1; else { aPts += tie; bPts += tie; }
      return { aPts, bPts, info: `Low ${aLow}/${bLow}, High ${aHigh}/${bHigh}`, complete: true };
    }
    if (modeId === "captainmate") {
      const aCap = A.playerIds?.[0]; const aMate = A.playerIds?.[1];
      const bCap = B.playerIds?.[0]; const bMate = B.playerIds?.[1];
      const aCapS = getScore(aCap, h), bCapS = getScore(bCap, h), aMateS = getScore(aMate, h), bMateS = getScore(bMate, h);
      if ([aCapS, bCapS, aMateS, bMateS].some(Number.isNaN)) return { aPts: 0, bPts: 0, info: "Waiting for scores", complete: false };
      let aPts = 0, bPts = 0; if (aCapS < bCapS) aPts += 1; else if (bCapS < aCapS) bPts += 1; else { aPts += 0.5; bPts += 0.5; }
      if (aMateS < bMateS) aPts += 1; else if (bMateS < aMateS) bPts += 1; else { aPts += 0.5; bPts += 0.5; }
      return { aPts, bPts, info: `Cap ${aCapS}/${bCapS}, Mate ${aMateS}/${bMateS}`, complete: true };
    }
    if (modeId === "stableford") {
      const sp = (sc, par) => { const d = sc - par; if (d <= -3) return 5; if (d === -2) return 4; if (d === -1) return 3; if (d === 0) return 2; if (d === 1) return 1; return 0; };
      const aPtsS = sp(aS[0], parArr[h]) + sp(aS[1], parArr[h]);
      const bPtsS = sp(bS[0], parArr[h]) + sp(bS[1], parArr[h]);
      if (aPtsS > bPtsS) return { aPts: 1, bPts: 0, info: `Stableford ${aPtsS}-${bPtsS}`, complete: true };
      if (bPtsS > aPtsS) return { aPts: 0, bPts: 1, info: `Stableford ${bPtsS}-${aPtsS}`, complete: true };
      return { aPts: 0.5, bPts: 0.5, info: `Stableford ${aPtsS}-${bPtsS} (push)`, complete: true };
    }
    if (modeId === "skins") {
      const aBest = Math.min(...aS), bBest = Math.min(...bS);
      if (aBest < bBest) return { aPts: 1, bPts: 0, info: `Skin A (${aBest} vs ${bBest})`, complete: true };
      if (bBest < aBest) return { aPts: 0, bPts: 1, info: `Skin B (${bBest} vs ${aBest})`, complete: true };
      return { aPts: 0, bPts: 0, info: "Skin halved", complete: true };
    }
    return { aPts: 0, bPts: 0, info: "Unknown mode", complete: false };
  }

  // Skins carryover: convert basic skins results into carry-aware results
  function applySkinsCarry(perHole) {
    let carry = 0;
    return perHole.map((r) => {
      if (!r.complete) {
        return { ...r, aPts: 0, bPts: 0, info: r.info + (carry ? ` (carry ${carry})` : "") };
      }
      // halved hole -> increase carry, no points awarded yet
      if (r.aPts === 0 && r.bPts === 0) {
        carry += 1;
        return { ...r, aPts: 0, bPts: 0, info: `Skin halved${carry ? ` (carry ${carry})` : ""}` };
      }
      // A wins -> award carry+1
      if (r.aPts > r.bPts) {
        const pts = carry + 1;
        const out = { ...r, aPts: pts, bPts: 0, info: `Skin A x${pts}` };
        carry = 0;
        return out;
      }
      // B wins -> award carry+1
      if (r.bPts > r.aPts) {
        const pts = carry + 1;
        const out = { ...r, aPts: 0, bPts: pts, info: `Skin B x${pts}` };
        carry = 0;
        return out;
      }
      return r;
    });
  }

  // For team value rows in the combined table (per-hole display for each team)
  function teamValue(modeId, h, T) {
    if (!T) return "-";
    const [p1, p2] = T.playerIds || [];
    const s1 = getScore(p1, h), s2 = getScore(p2, h);
    if ([s1, s2].some(Number.isNaN)) return "-";
    if (modeId === "bestball" || modeId === "skins") return Math.min(s1, s2);
    if (modeId === "aggregate") return s1 + s2;
    if (modeId === "highlow") return `${Math.min(s1, s2)}/${Math.max(s1, s2)}`;
    if (modeId === "captainmate") return `${s1}/${s2}`; // first = captain
    if (modeId === "stableford") {
      const sp = (sc, par) => { const d = sc - par; if (d <= -3) return 5; if (d === -2) return 4; if (d === -1) return 3; if (d === 0) return 2; if (d === 1) return 1; return 0; };
      return sp(s1, parArr[h]) + sp(s2, parArr[h]);
    }
    return "-";
  }

  // UI helpers for cells
  const HoleTh = ({ i }) => (
    <th className="p-2 border" style={{ backgroundColor: holeBgForPar(parArr[i]) }}>H{i + 1}</th>
  );
  const HoleTd = ({ i, children, className = "" }) => (
    <td className={`border ${className}`} style={{ backgroundColor: holeBgForPar(parArr[i]) }}>{children}</td>
  );

  const totalPar = parArr.reduce((a, b) => a + b, 0);

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-white text-black">
      <div className="container mx-auto p-4 space-y-6">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Golf Trip Mini App — Binghamton, NY</h1>
            <p className="text-sm text-gray-600">Unique players per team • Multiple matches • Combined scorecard/matchboard</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={() => setScoresByCourse((prev)=>({ ...prev, [courseKey]: Object.fromEntries(players.map((p)=>[p.id, empty18()])) }))}>Reset scores (course)</button>
          </div>
        </header>

        {/* Setup Row */}
        <section className="grid md:grid-cols-3 gap-4">
          {/* Course */}
          <div className="rounded-2xl border shadow p-4 space-y-3">
            <h2 className="font-semibold">1) Course</h2>
            <select value={courseKey} onChange={(e) => setCourseKey(e.target.value)} className="w-full border rounded-xl px-3 py-2">
              {COURSES.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select>
            <p className="text-xs text-gray-600">Par 3 = light gray • Par 4 = white • Par 5 = darker gray.</p>
          </div>

          {/* Players */}
          <div className="rounded-2xl border shadow p-4 space-y-3">
            <h2 className="font-semibold">2) Players</h2>
            <div className="space-y-2 max-h-60 overflow-auto pr-1">
              {players.map((p) => (
                <div key={p.id} className="flex items-center gap-2">
                  <input value={p.name} onChange={(e) => renamePlayer(p.id, e.target.value)} className="flex-1 border rounded-xl px-3 py-1"/>
                  <button onClick={() => removePlayer(p.id)} className="text-xs px-2 py-1 border rounded-xl">Remove</button>
                </div>
              ))}
            </div>
            <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={() => addPlayer()}>Add player</button>
          </div>

          {/* Teams (unique players) */}
          <div className="rounded-2xl border shadow p-4 space-y-3">
            <h2 className="font-semibold">3) Teams (max 2 players, unique)</h2>
            <div className="space-y-3 max-h-60 overflow-auto pr-1">
              {teams.map((t) => {
                const current = new Set(t.playerIds || []);
                return (
                  <div key={t.id} className="border rounded-xl p-2">
                    <div className="flex items-center gap-2 mb-2">
                      <input value={t.name} onChange={(e) => setTeamName(t.id, e.target.value)} className="flex-1 border rounded-xl px-3 py-1"/>
                      <button onClick={() => removeTeam(t.id)} className="text-xs px-2 py-1 border rounded-xl">Remove</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[0,1].map((slot) => (
                        <select key={slot}
                                value={t.playerIds?.[slot] || ""}
                                onChange={(e) => assignPlayer(t.id, slot, e.target.value)}
                                className="border rounded-xl px-2 py-1">
                          <option value="">— Select —</option>
                          {players.filter(pl => !assignedPlayerIds.has(pl.id) || current.has(pl.id))
                                  .map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                        </select>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">A player can only be on one team at a time.</p>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={addTeam}>Add team</button>
              <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={autoPair}>Auto‑pair players</button>
            </div>
          </div>
        </section>

        {/* Matches */}
        <section className="rounded-2xl border shadow p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">4) Matches (each has its own mode)</h2>
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={addMatch}>Add match</button>
              <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={exportMatches}>Save matches</button>
              <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={() => matchesFileInputRef.current?.click()}>Load matches</button>
              <input ref={matchesFileInputRef} type="file" accept="application/json" onChange={handleMatchesFile} className="hidden" />
            </div>
          </div>

          {matches.length === 0 && <p className="text-sm text-gray-600">No matches yet. Add one to start scoring.</p>}

          {matches.map((m) => {
            const tA = teamById(m.teamAId);
            const tB = teamById(m.teamBId);

            // Team pick lists: hide teams already in other matches, but allow the team currently selected here
            const inUseElsewhere = new Set(matches.filter(x => x.id !== m.id).flatMap(x => [x.teamAId, x.teamBId].filter(Boolean)));
            const teamOptionsA = teams.filter(t => !inUseElsewhere.has(t.id) && t.id !== m.teamBId);
            const teamOptionsB = teams.filter(t => !inUseElsewhere.has(t.id) && t.id !== m.teamAId);

            // Per-hole results for this match
            let perHole = Array.from({ length: 18 }, (_, h) => computeHole(m.mode, h, tA, tB));
            if (m.mode === "skins") perHole = applySkinsCarry(perHole);
            const totals = perHole.reduce((acc, r) => ({ a: acc.a + (r.complete ? r.aPts : 0), b: acc.b + (r.complete ? r.bPts : 0) }), { a: 0, b: 0 });
            const completedCount = perHole.filter(r => r.complete).length;

            const teamRowA = Array.from({ length: 18 }, (_, h) => teamValue(m.mode, h, tA));
            const teamRowB = Array.from({ length: 18 }, (_, h) => teamValue(m.mode, h, tB));

            // Points rows per team
            const aPtsRow = perHole.map((r) => r.complete ? r.aPts : "-");
            const bPtsRow = perHole.map((r) => r.complete ? r.bPts : "-");

            const title = `Scorecard — ${course.name} — ${tA?.name || "Team A"} vs ${tB?.name || "Team B"}`;

            return (
              <div key={m.id} className="rounded-xl border p-3 space-y-3">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <select value={m.teamAId} onChange={(e) => setMatchField(m.id, 'teamAId', e.target.value)} className="border rounded-xl px-3 py-2 min-w-[180px]">
                      <option value="">— Select Team A —</option>
                      {teamOptionsA.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <select value={m.teamBId} onChange={(e) => setMatchField(m.id, 'teamBId', e.target.value)} className="border rounded-xl px-3 py-2 min-w-[180px]">
                      <option value="">— Select Team B —</option>
                      {teamOptionsB.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <select value={m.mode} onChange={(e) => setMatchField(m.id, 'mode', e.target.value)} className="border rounded-xl px-3 py-2 min-w-[180px]">
                      {MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-3 py-2 rounded-2xl border shadow text-sm" onClick={() => removeMatch(m.id)}>Remove match</button>
                  </div>
                </div>

                <h3 className="font-semibold">{title}</h3>

                <div className="overflow-x-auto">
                  <table className="min-w-[1000px] w-full border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left p-2 border">Row</th>
                        {Array.from({ length: 18 }).map((_, i) => <HoleTh key={i} i={i} />)}
                        <th className="p-2 border">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* PAR row */}
                      <tr>
                        <td className="p-2 border font-medium">Par</td>
                        {parArr.map((p, i) => (
                          <HoleTd key={i} i={i} className="text-center"><span style={{ color: "#6b7280" }}>{p}</span></HoleTd>
                        ))}
                        <td className="p-2 border text-center font-semibold">{totalPar}</td>
                      </tr>

                      {/* Team A players */}
                      {tA?.playerIds?.map((pid, idx) => (
                        <tr key={pid || idx}>
                          <td className="p-2 border whitespace-nowrap">{players.find(p => p.id === pid)?.name || (idx === 0 ? "A Player 1" : "A Player 2")}</td>
                          {Array.from({ length: 18 }).map((_, h) => {
                            const v = (scoresByCourse[courseKey] || {})[pid]?.[h] ?? "";
                            const color = colorForRelative(v, parArr[h]);
                            return (
                              <HoleTd key={h} i={h}>
                                <input
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="w-16 md:w-14 border rounded-lg px-2 py-1 text-center bg-white"
                                  style={{ color }}
                                  value={v}
                                  onChange={(e) => setScore(pid, h, e.target.value.replace(/[^0-9]/g, ""))}
                                />
                              </HoleTd>
                            );
                          })}
                          <td className="p-2 border text-center font-semibold">{pid ? (scoresByCourse[courseKey]?.[pid] || empty18()).reduce((s, v) => s + (Number(v) || 0), 0) : 0}</td>
                        </tr>
                      ))}

                      {/* Team A value row */}
                      <tr>
                        <td className="p-2 border font-medium">{tA?.name || "Team A"}</td>
                        {Array.from({ length: 18 }).map((_, i) => {
                          const val = teamRowA[i];
                          const pts = perHole[i].complete ? perHole[i].aPts : 0;
                          const n = Number(val);
                          const basis = m.mode === "aggregate" ? parArr[i] * 2 : parArr[i];
                          const colored = Number.isFinite(n) && (m.mode === "bestball" || m.mode === "skins" || m.mode === "aggregate");
                          return (
                            <HoleTd key={i} i={i} className="text-center">
                              <div className="leading-tight">
                                {colored ? (
                                  <span style={{ color: colorForRelative(n, basis) }}>{String(val)}</span>
                                ) : (
                                  <span>{String(val)}</span>
                                )}
                                <div className="text-xs text-gray-700">({Number(pts).toFixed(1)})</div>
                              </div>
                            </HoleTd>
                          );
                        })}
                        <td className="p-2 border text-center font-bold">
                          {completedCount ? perHole.reduce((s, r) => s + (r.complete ? r.aPts : 0), 0).toFixed(1) : 0}
                        </td>
                      </tr>

                      {/* Team B players */}
                      {tB?.playerIds?.map((pid, idx) => (
                        <tr key={pid || idx}>
                          <td className="p-2 border whitespace-nowrap">{players.find(p => p.id === pid)?.name || (idx === 0 ? "B Player 1" : "B Player 2")}</td>
                          {Array.from({ length: 18 }).map((_, h) => {
                            const v = (scoresByCourse[courseKey] || {})[pid]?.[h] ?? "";
                            const color = colorForRelative(v, parArr[h]);
                            return (
                              <HoleTd key={h} i={h}>
                                <input
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  className="w-16 md:w-14 border rounded-lg px-2 py-1 text-center bg-white"
                                  style={{ color }}
                                  value={v}
                                  onChange={(e) => setScore(pid, h, e.target.value.replace(/[^0-9]/g, ""))}
                                />
                              </HoleTd>
                            );
                          })}
                          <td className="p-2 border text-center font-semibold">{pid ? (scoresByCourse[courseKey]?.[pid] || empty18()).reduce((s, v) => s + (Number(v) || 0), 0) : 0}</td>
                        </tr>
                      ))}

                      {/* Team B value row */}
                      <tr>
                        <td className="p-2 border font-medium">{tB?.name || "Team B"}</td>
                        {Array.from({ length: 18 }).map((_, i) => {
                          const val = teamRowB[i];
                          const pts = perHole[i].complete ? perHole[i].bPts : 0;
                          const n = Number(val);
                          const basis = m.mode === "aggregate" ? parArr[i] * 2 : parArr[i];
                          const colored = Number.isFinite(n) && (m.mode === "bestball" || m.mode === "skins" || m.mode === "aggregate");
                          return (
                            <HoleTd key={i} i={i} className="text-center">
                              <div className="leading-tight">
                                {colored ? (
                                  <span style={{ color: colorForRelative(n, basis) }}>{String(val)}</span>
                                ) : (
                                  <span>{String(val)}</span>
                                )}
                                <div className="text-xs text-gray-700">({Number(pts).toFixed(1)})</div>
                              </div>
                            </HoleTd>
                          );
                        })}
                        <td className="p-2 border text-center font-bold">
                          {completedCount ? perHole.reduce((s, r) => s + (r.complete ? r.bPts : 0), 0).toFixed(1) : 0}
                        </td>
                      </tr>

                      

                      {/* Result row */}
                      <tr>
                        <td className="p-2 border text-gray-600">Result</td>
                        {perHole.map((r, i) => <HoleTd key={i} i={i} className="text-center text-xs text-gray-700">{r.complete ? r.info : "—"}</HoleTd>)}
                        <td className="p-2 border text-center font-semibold">{completedCount === 0 ? "No scores yet" : (totals.a > totals.b ? `${tA?.name || "A"} up ${(totals.a - totals.b).toFixed(1)}` : totals.b > totals.a ? `${tB?.name || "B"} up ${(totals.b - totals.a).toFixed(1)}` : "All square")}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>

        <footer className="text-center text-xs text-gray-500 pb-8">Players are unique to one team • Teams can be used in only one match at a time • No storage</footer>
      </div>
    </div>
  );
}

