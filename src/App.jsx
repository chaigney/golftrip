import React, { useEffect, useMemo, useState, useRef } from 'react'
import { db } from './firebase'
import {
  doc, setDoc, onSnapshot, updateDoc, serverTimestamp,
} from 'firebase/firestore'

/** ---------------------------------------------
 * Courses (par per hole)
 * ----------------------------------------------*/
const COURSES = [
  { key: "hiawatha", name: "The Links at Hiawatha Landing", par: [4,4,3,4,4,3,5,4,5, 4,4,5,3,4,4,3,5,4] },
  { key: "enjoie",   name: "En-Joie Golf Club",             par: [4,4,5,3,5,4,3,5,4, 4,4,5,4,3,4,4,3,4] },
  { key: "conklin",  name: "Conklin Players Club",          par: [4,3,4,4,4,5,3,4,5, 3,4,4,3,5,4,4,4,5] },
]

const MODES = [
  { id: "bestball",    name: "Best Ball (1 pt)" },
  { id: "highlow",     name: "High–Low (2 pts)" },
  { id: "captainmate", name: "Captain & Mate (2 pts)" },
  { id: "aggregate",   name: "Aggregate (1 pt)" },
  { id: "stableford",  name: "Stableford (1 pt)" },
  { id: "skins",       name: "Skins (carry)" },
]

/** ---------------------------------------------
 * Visual helpers
 * ----------------------------------------------*/
const empty18 = () => Array.from({ length: 18 }, () => "")

function holeBgForPar(par) {
  if (par === 3) return "#f5f5f5" // light gray
  if (par === 4) return "#ffffff" // white
  if (par === 5) return "#e5e7eb" // slightly darker gray
  return "#ffffff"
}
function colorForRelative(score, par) {
  const n = Number(score)
  if (!Number.isFinite(n)) return "#000000"
  const d = n - par
  if (d <= -3) return "#6d28d9" // albatross+
  if (d === -2) return "#0891b2" // eagle
  if (d === -1) return "#16a34a" // birdie
  if (d === 0)  return "#000000" // par
  if (d === 1)  return "#f59e0b" // bogey
  if (d === 2)  return "#ef4444" // double
  return "#991b1b"               // 3+ over
}

function uid() { return Math.random().toString(36).slice(2, 9) }

/** ---------------------------------------------
 * Trip helpers (URL binding)
 * ----------------------------------------------*/
function getTripIdFromUrl() {
  const url = new URL(window.location.href)
  return url.searchParams.get('trip') || ''
}
function setTripIdInUrl(id) {
  const url = new URL(window.location.href)
  url.searchParams.set('trip', id)
  window.history.replaceState({}, '', url.toString())
}

export default function App() {
  // remote-backed state
  const [tripId, setTripId] = useState(getTripIdFromUrl())
  const [players, setPlayers] = useState([]) // {id, name}[]
  const [teams, setTeams]     = useState([]) // {id, name, playerIds:[p1,p2]}
  const [matches, setMatches] = useState([]) // {id, teamAId, teamBId, mode}
  const [courseKey, setCourseKey] = useState(COURSES[0].key)
  const [scoresByCourse, setScoresByCourse] = useState({
    hiawatha: {}, enjoie: {}, conklin: {}
  }) // { [courseKey]: { [playerId]: string[18] } }
  const [connected, setConnected] = useState(false)
  const [saving, setSaving] = useState(false)

  const course = COURSES.find(c => c.key === courseKey) || COURSES[0]
  const parArr = course.par

  /** -------------------------------------------
   * Firestore: subscribe to trip doc
   * --------------------------------------------*/
  useEffect(() => {
    if (!tripId) return
    const ref = doc(db, 'trips', tripId)
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return
      const d = snap.data()
      setPlayers(d.players || [])
      setTeams(d.teams || [])
      setMatches(d.matches || [])
      setCourseKey(d.courseKey || COURSES[0].key)
      setScoresByCourse(d.scoresByCourse || { hiawatha: {}, enjoie: {}, conklin: {} })
      setConnected(true)
    })
    return () => unsub()
  }, [tripId])

  async function createTrip() {
    const newId = uid() + uid()
    const ref = doc(db, 'trips', newId)
    const init = {
      createdAt: serverTimestamp(),
      players: [], teams: [], matches: [],
      courseKey: COURSES[0].key,
      scoresByCourse: { hiawatha: {}, enjoie: {}, conklin: {} },
    }
    await setDoc(ref, init)
    setTripId(newId)
    setTripIdInUrl(newId)
  }

  // Debounced write (used ONLY for score typing)
  const writeTimer = useRef(null)
  function scheduleScoreSave() {
    if (!tripId) return
    setSaving(true)
    clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(async () => {
      await updateDoc(doc(db, 'trips', tripId), {
        players, teams, matches, courseKey, scoresByCourse, updatedAt: serverTimestamp(),
      })
      setSaving(false)
    }, 250)
  }

  // Immediate write (used for players/teams/matches/course changes)
  async function saveNow(patch) {
    if (!tripId) return
    setSaving(true)
    await updateDoc(doc(db, 'trips', tripId), { ...patch, updatedAt: serverTimestamp() })
    setSaving(false)
  }

  /** -------------------------------------------
   * Players / Teams
   * --------------------------------------------*/
  const assignedPlayerIds = useMemo(
    () => new Set(teams.flatMap(t => (t.playerIds || []).filter(Boolean))),
    [teams]
  )

  const addPlayer = async (name = "") => {
    const p = { id: uid(), name: name || `Player ${players.length + 1}` }
    const nextPlayers = [...players, p]
    const perCourse = { ...(scoresByCourse[courseKey] || {}), [p.id]: empty18() }
    const nextScores = { ...scoresByCourse, [courseKey]: perCourse }
    setPlayers(nextPlayers)
    setScoresByCourse(nextScores)
    await saveNow({ players: nextPlayers, scoresByCourse: nextScores })
  }

  const renamePlayer = async (id, name) => {
    const nextPlayers = players.map(p => p.id === id ? { ...p, name } : p)
    setPlayers(nextPlayers)
    await saveNow({ players: nextPlayers })
  }

  const removePlayer = async (id) => {
    const nextPlayers = players.filter(p => p.id !== id)
    const nextTeams = teams.map(t => ({ ...t, playerIds: (t.playerIds || []).map(pid => pid === id ? "" : pid) }))
    const perCourse = { ...(scoresByCourse[courseKey] || {}) }; delete perCourse[id]
    const nextScores = { ...scoresByCourse, [courseKey]: perCourse }
    setPlayers(nextPlayers); setTeams(nextTeams); setScoresByCourse(nextScores)
    await saveNow({ players: nextPlayers, teams: nextTeams, scoresByCourse: nextScores })
  }

  const addTeam = async () => {
    const nextTeams = [...teams, { id: uid(), name: `Team ${teams.length + 1}`, playerIds: ["",""] }]
    setTeams(nextTeams)
    await saveNow({ teams: nextTeams })
  }

  const setTeamName = async (id, name) => {
    const nextTeams = teams.map(t => t.id === id ? { ...t, name } : t)
    setTeams(nextTeams)
    await saveNow({ teams: nextTeams })
  }

  // One player can only be on one team at a time
  const assignPlayer = async (teamId, slotIdx, newPid) => {
    let nextTeams = teams
    if (!newPid) {
      nextTeams = teams.map(t => t.id === teamId ? { ...t, playerIds: Object.assign([], t.playerIds, { [slotIdx]: "" }) } : t)
    } else {
      const cleared = teams.map(t => ({ ...t, playerIds: (t.playerIds || []).map(pid => pid === newPid ? "" : pid) }))
      nextTeams = cleared.map(t => t.id === teamId ? { ...t, playerIds: Object.assign([], t.playerIds, { [slotIdx]: newPid }) } : t)
    }
    setTeams(nextTeams)
    await saveNow({ teams: nextTeams })
  }

  const removeTeam = async (id) => {
    const nextTeams = teams.filter(t => t.id !== id)
    const nextMatches = matches.filter(m => m.teamAId !== id && m.teamBId !== id)
    setTeams(nextTeams); setMatches(nextMatches)
    await saveNow({ teams: nextTeams, matches: nextMatches })
  }

  /** -------------------------------------------
   * Matches (each with its own mode)
   * --------------------------------------------*/
  const addMatch = async () => {
    const nextMatches = [...matches, { id: uid(), teamAId: "", teamBId: "", mode: MODES[0].id }]
    setMatches(nextMatches)
    await saveNow({ matches: nextMatches })
  }
  const removeMatch = async (mid) => {
    const nextMatches = matches.filter(m => m.id !== mid)
    setMatches(nextMatches)
    await saveNow({ matches: nextMatches })
  }
  const setMatchField = async (mid, field, value) => {
    const nextMatches = matches.map(m => m.id === mid ? { ...m, [field]: value } : m)
    setMatches(nextMatches)
    await saveNow({ matches: nextMatches })
  }

  /** -------------------------------------------
   * Scores
   * --------------------------------------------*/
  const ensurePlayerScores = (pid) => setScoresByCourse(prev => {
    const m = prev[courseKey] || {}
    if (!m[pid]) return { ...prev, [courseKey]: { ...m, [pid]: empty18() } }
    return prev
  })

  const setScore = (pid, h, value) => {
    ensurePlayerScores(pid)
    setScoresByCourse(prev => {
      const map = { ...(prev[courseKey] || {}) }
      const arr = map[pid] ? [...map[pid]] : empty18()
      arr[h] = value
      map[pid] = arr
      const next = { ...prev, [courseKey]: map }
      // debounce just the scores writes
      scheduleScoreSave()
      return next
    })
  }

  const getScore = (pid, h) => {
    const v = (scoresByCourse[courseKey] || {})[pid]?.[h]
    if (v === "" || v === null || v === undefined) return NaN
    const n = Number(v); return Number.isFinite(n) ? n : NaN
  }

  /** -------------------------------------------
   * Per-hole computation (points only when hole complete)
   * --------------------------------------------*/
  function computeHole(modeId, h, A, B) {
    if (!A || !B) return { aPts: 0, bPts: 0, info: "Pick two teams", complete: false }
    const [a1, a2] = A.playerIds || [], [b1, b2] = B.playerIds || []
    if (!a1 || !a2 || !b1 || !b2) return { aPts: 0, bPts: 0, info: "Both teams need two players", complete: false }
    const aS = [getScore(a1, h), getScore(a2, h)]
    const bS = [getScore(b1, h), getScore(b2, h)]
    if (aS.some(Number.isNaN) || bS.some(Number.isNaN)) return { aPts: 0, bPts: 0, info: "Waiting for scores", complete: false }

    const tie = 0.5
    if (modeId === "bestball") {
      const aBest = Math.min(...aS), bBest = Math.min(...bS)
      if (aBest < bBest) return { aPts: 1, bPts: 0, info: `A best ${aBest} beats ${bBest}`, complete: true }
      if (bBest < aBest) return { aPts: 0, bPts: 1, info: `B best ${bBest} beats ${aBest}`, complete: true }
      return { aPts: tie, bPts: tie, info: "Push", complete: true }
    }
    if (modeId === "aggregate") {
      const aTot = aS[0] + aS[1], bTot = bS[0] + bS[1]
      if (aTot < bTot) return { aPts: 1, bPts: 0, info: `A ${aTot} vs ${bTot}`, complete: true }
      if (bTot < aTot) return { aPts: 0, bPts: 1, info: `B ${bTot} vs ${aTot}`, complete: true }
      return { aPts: tie, bPts: tie, info: "Push", complete: true }
    }
    if (modeId === "highlow") {
      let aPts = 0, bPts = 0
      const aLow = Math.min(...aS), aHigh = Math.max(...aS)
      const bLow = Math.min(...bS), bHigh = Math.max(...bS)
      if (aLow < bLow) aPts += 1; else if (bLow < aLow) bPts += 1; else { aPts += tie; bPts += tie }
      if (aHigh < bHigh) aPts += 1; else if (bHigh < aHigh) bPts += 1; else { aPts += tie; bPts += tie }
      return { aPts, bPts, info: `Low ${aLow}/${bLow}, High ${aHigh}/${bHigh}`, complete: true }
    }
    if (modeId === "captainmate") {
      const aCap = A.playerIds?.[0], aMate = A.playerIds?.[1]
      const bCap = B.playerIds?.[0], bMate = B.playerIds?.[1]
      const aCapS = getScore(aCap, h), bCapS = getScore(bCap, h)
      const aMateS = getScore(aMate, h), bMateS = getScore(bMate, h)
      if ([aCapS, bCapS, aMateS, bMateS].some(Number.isNaN)) return { aPts: 0, bPts: 0, info: "Waiting for scores", complete: false }
      let aPts = 0, bPts = 0
      if (aCapS < bCapS) aPts += 1; else if (bCapS < aCapS) bPts += 1; else { aPts += tie; bPts += tie }
      if (aMateS < bMateS) aPts += 1; else if (bMateS < aMateS) bPts += 1; else { aPts += tie; bPts += tie }
      return { aPts, bPts, info: `Cap ${aCapS}/${bCapS}, Mate ${aMateS}/${bMateS}`, complete: true }
    }
    if (modeId === "stableford") {
      const sp = (sc, par) => {
        const d = sc - par
        if (d <= -3) return 5
        if (d === -2) return 4
        if (d === -1) return 3
        if (d === 0)  return 2
        if (d === 1)  return 1
        return 0
      }
      const aPtsS = sp(aS[0], parArr[h]) + sp(aS[1], parArr[h])
      const bPtsS = sp(bS[0], parArr[h]) + sp(bS[1], parArr[h])
      if (aPtsS > bPtsS) return { aPts: 1, bPts: 0, info: `Stableford ${aPtsS}-${bPtsS}`, complete: true }
      if (bPtsS > aPtsS) return { aPts: 0, bPts: 1, info: `Stableford ${bPtsS}-${aPtsS}`, complete: true }
      return { aPts: 0.5, bPts: 0.5, info: `Stableford ${aPtsS}-${bPtsS} (push)`, complete: true }
    }
    if (modeId === "skins") {
      const aBest = Math.min(...aS), bBest = Math.min(...bS)
      if (aBest < bBest) return { aPts: 1, bPts: 0, info: `Skin A (${aBest} vs ${bBest})`, complete: true }
      if (bBest < aBest) return { aPts: 0, bPts: 1, info: `Skin B (${bBest} vs ${aBest})`, complete: true }
      return { aPts: 0, bPts: 0, info: "Skin halved", complete: true }
    }
    return { aPts: 0, bPts: 0, info: "Unknown mode", complete: false }
  }

  // Skins carry-over
  function applySkinsCarry(perHole) {
    let carry = 0
    return perHole.map((r) => {
      if (!r.complete) return { ...r, aPts: 0, bPts: 0, info: r.info + (carry ? ` (carry ${carry})` : "") }
      if (r.aPts === 0 && r.bPts === 0) { carry += 1; return { ...r, aPts: 0, bPts: 0, info: `Skin halved${carry ? ` (carry ${carry})` : ""}` } }
      if (r.aPts > r.bPts) { const pts = carry + 1; carry = 0; return { ...r, aPts: pts, bPts: 0, info: `Skin A x${pts}` } }
      if (r.bPts > r.aPts) { const pts = carry + 1; carry = 0; return { ...r, aPts: 0, bPts: pts, info: `Skin B x${pts}` } }
      return r
    })
  }

  // Team-value display (what number to show in the team row)
  function teamValue(modeId, h, T) {
    if (!T) return "-"
    const [p1, p2] = T.playerIds || []
    const s1 = getScore(p1, h), s2 = getScore(p2, h)
    if ([s1, s2].some(Number.isNaN)) return "-"
    if (modeId === "bestball" || modeId === "skins") return Math.min(s1, s2)
    if (modeId === "aggregate")  return s1 + s2
    if (modeId === "highlow")    return `${Math.min(s1, s2)}/${Math.max(s1, s2)}`
    if (modeId === "captainmate")return `${s1}/${s2}`
    if (modeId === "stableford") {
      const sp = (sc, par) => {
        const d = sc - par
        if (d <= -3) return 5
        if (d === -2) return 4
        if (d === -1) return 3
        if (d === 0)  return 2
        if (d === 1)  return 1
        return 0
      }
      return sp(s1, parArr[h]) + sp(s2, parArr[h])
    }
    return "-"
  }

  // Overall team records across completed matches
  const teamRecords = useMemo(() => {
    const rec = new Map()
    function bump(id, field) {
      const row = rec.get(id) || { w: 0, l: 0, t: 0 }
      row[field] += 1
      rec.set(id, row)
    }
    for (const m of matches) {
      const A = teams.find(t => t.id === m.teamAId)
      const B = teams.find(t => t.id === m.teamBId)
      if (!A || !B) continue
      let perHole = Array.from({ length: 18 }, (_, h) => computeHole(m.mode, h, A, B))
      if (m.mode === "skins") perHole = applySkinsCarry(perHole)
      const allComplete = perHole.every(r => r.complete)
      if (!allComplete) continue
      const totals = perHole.reduce((acc, r) => ({
        a: acc.a + (r.complete ? r.aPts : 0),
        b: acc.b + (r.complete ? r.bPts : 0),
      }), { a: 0, b: 0 })
      if (totals.a > totals.b) { bump(A.id, 'w'); bump(B.id, 'l') }
      else if (totals.b > totals.a) { bump(B.id, 'w'); bump(A.id, 'l') }
      else { bump(A.id, 't'); bump(B.id, 't') }
    }
    return rec
  }, [matches, teams, scoresByCourse, courseKey])

  /** -------------------------------------------
   * UI
   * --------------------------------------------*/
  if (!tripId) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1>Golf Trip App</h1>
        <p>Create a shared trip so everyone can edit scores from their phones.</p>
        <button onClick={createTrip}>Create Trip</button>
        <p style={{ marginTop: 12, fontSize: 12, opacity: .7 }}>
          After creating, share the URL (it will contain <code>?trip=&lt;id&gt;</code>).
        </p>
      </div>
    )
  }

  const assignedSet = assignedPlayerIds

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#000', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <h2 style={{ margin: '8px 0' }}>Golf Trip — Shared Room: <code>{tripId}</code></h2>
          <div style={{ fontSize: 12, opacity: .7 }}>
            {connected ? 'Connected ✅' : 'Connecting…'} {saving ? '• Saving…' : ''}
          </div>
        </div>
        <div>
          <select
            value={courseKey}
            onChange={async (e) => {
              const next = e.target.value
              setCourseKey(next)
              await saveNow({ courseKey: next })
            }}>
            {COURSES.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </div>
      </header>

      {/* Players / Teams / Matches setup */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
        {/* Players */}
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, background: '#fff' }}>
          <h3>Players</h3>
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {players.map(p => (
              <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input value={p.name} onChange={(e) => { renamePlayer(p.id, e.target.value) }} />
                <button onClick={() => removePlayer(p.id)}>Remove</button>
              </div>
            ))}
          </div>
          <button onClick={() => addPlayer()}>Add player</button>
        </div>

        {/* Teams */}
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, background: '#fff' }}>
          <h3>Teams</h3>
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {teams.map(t => {
              const current = new Set(t.playerIds || [])
              return (
                <div key={t.id} style={{ border: '1px solid #eee', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input value={t.name} onChange={(e) => { setTeamName(t.id, e.target.value) }} />
                    <button onClick={() => removeTeam(t.id)}>Remove</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    {[0, 1].map(slot => (
                      <select key={slot} value={t.playerIds?.[slot] || ''} onChange={e => assignPlayer(t.id, slot, e.target.value)}>
                        <option value=''>— Select —</option>
                        {players
                          .filter(pl => !assignedSet.has(pl.id) || current.has(pl.id))
                          .map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                      </select>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <button onClick={addTeam}>Add team</button>
        </div>

        {/* Matches */}
        <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, background: '#fff' }}>
          <h3>Matches</h3>
          <button onClick={addMatch}>Add match</button>
          <div style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>
            Each match has its own mode. A team can only play one match at a time, and a team can’t face itself.
          </div>
        </div>
      </section>

      {/* Scorecards (combined with matchboard) */}
      {matches.map((m) => {
        const tA = teams.find(t => t.id === m.teamAId)
        const tB = teams.find(t => t.id === m.teamBId)

        // prevent reusing the same team in multiple matches + vs itself
        const inUseElsewhere = new Set(
          matches.filter(x => x.id !== m.id).flatMap(x => [x.teamAId, x.teamBId].filter(Boolean))
        )
        const teamOptionsA = teams.filter(t => !inUseElsewhere.has(t.id) && t.id !== m.teamBId)
        const teamOptionsB = teams.filter(t => !inUseElsewhere.has(t.id) && t.id !== m.teamAId)

        let perHole = Array.from({ length: 18 }, (_, h) => computeHole(m.mode, h, tA, tB))
        if (m.mode === "skins") perHole = applySkinsCarry(perHole)

        const totals = perHole.reduce((acc, r) => ({
          a: acc.a + (r.complete ? r.aPts : 0),
          b: acc.b + (r.complete ? r.bPts : 0),
        }), { a: 0, b: 0 })
        const completedCount = perHole.filter(r => r.complete).length

        const teamRowA = Array.from({ length: 18 }, (_, h) => teamValue(m.mode, h, tA))
        const teamRowB = Array.from({ length: 18 }, (_, h) => teamValue(m.mode, h, tB))

        const courseName = COURSES.find(c => c.key === courseKey)?.name
        const title = `Scorecard — ${courseName} — ${tA?.name || 'Team A'} vs ${tB?.name || 'Team B'}`

        return (
          <section key={m.id} style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, marginTop: 12, background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={m.teamAId} onChange={e => setMatchField(m.id, 'teamAId', e.target.value)}>
                <option value=''>— Select Team A —</option>
                {teamOptionsA.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={m.teamBId} onChange={e => setMatchField(m.id, 'teamBId', e.target.value)}>
                <option value=''>— Select Team B —</option>
                {teamOptionsB.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={m.mode} onChange={e => setMatchField(m.id, 'mode', e.target.value)}>
                {MODES.map(md => <option key={md.id} value={md.id}>{md.name}</option>)}
              </select>
              <button onClick={() => removeMatch(m.id)} style={{ marginLeft: 'auto' }}>Remove match</button>
            </div>

            <h4 style={{ margin: '8px 0' }}>{title}</h4>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 940, width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #ccc', padding: 6, textAlign: 'left' }}>Row</th>
                    {Array.from({ length: 18 }).map((_, i) => (
                      <th key={i} style={{ border: '1px solid #ccc', padding: 6, backgroundColor: holeBgForPar(parArr[i]) }}>H{i + 1}</th>
                    ))}
                    <th style={{ border: '1px solid #ccc', padding: 6 }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Par row */}
                  <tr>
                    <td style={{ border: '1px solid #ccc', padding: 6, fontWeight: 600 }}>Par</td>
                    {parArr.map((p, i) => (
                      <td key={i} style={{
                        border: '1px solid #ccc', padding: 6,
                        backgroundColor: holeBgForPar(parArr[i]),
                        textAlign: 'center', color: '#6b7280'
                      }}>
                        {p}
                      </td>
                    ))}
                    <td style={{ border: '1px solid #ccc', padding: 6, textAlign: 'center', fontWeight: 600 }}>
                      {parArr.reduce((a, b) => a + b, 0)}
                    </td>
                  </tr>

                  {/* Team A player rows */}
                  {tA?.playerIds?.map((pid, idx) => (
                    <tr key={pid || idx}>
                      <td style={{ border: '1px solid #ccc', padding: 6 }}>
                        {(players.find(p => p.id === pid)?.name) || (idx === 0 ? 'A Player 1' : 'A Player 2')}
                      </td>
                      {Array.from({ length: 18 }).map((_, h) => {
                        const v = (scoresByCourse[courseKey] || {})[pid]?.[h] ?? ''
                        const color = colorForRelative(v, parArr[h])
                        return (
                          <td key={h} style={{ border: '1px solid #ccc', padding: 6, backgroundColor: holeBgForPar(parArr[h]) }}>
                            <input
                              inputMode='numeric' pattern='[0-9]*'
                              value={v}
                              onChange={(e) => setScore(pid, h, e.target.value.replace(/[^0-9]/g, ''))}
                              style={{ width: 48, textAlign: 'center', color }}
                            />
                          </td>
                        )
                      })}
                      <td style={{ border: '1px solid #ccc', padding: 6, textAlign: 'center', fontWeight: 600 }}>
                        {(scoresByCourse[courseKey]?.[pid] || empty18()).reduce((s, v) => s + (Number(v) || 0), 0)}
                      </td>
                    </tr>
                  ))}

                  {/* Team A combined row (value + per-hole points) */}
                  <tr>
                    <td style={{ border: '1px solid #ccc', padding: 6, fontWeight: 600 }}>{tA?.name || 'Team A'}</td>
                    {Array.from({ length: 18 }).map((_, i) => {
                      const val = teamRowA[i]
                      const pts = perHole[i].complete ? perHole[i].aPts : 0
                      const n = Number(val)
                      const basis = (m.mode === "aggregate") ? parArr[i] * 2 : parArr[i]
                      const colored = Number.isFinite(n) && (m.mode === "bestball" || m.mode === "skins" || m.mode === "aggregate")
                      return (
                        <td key={i} style={{ border: '1px solid #ccc', padding: 6, backgroundColor: holeBgForPar(parArr[i]), textAlign: 'center' }}>
                          <div style={{ lineHeight: 1.1 }}>
                            {colored ? <span style={{ color: colorForRelative(n, basis) }}>{String(val)}</span> : <span>{String(val)}</span>}
                            <div style={{ fontSize: 12, color: '#374151' }}>({Number(pts).toFixed(1)})</div>
                          </div>
                        </td>
                      )
                    })}
                    <td style={{ border: '1px solid #ccc', padding: 6, textAlign: 'center', fontWeight: 700 }}>
                      {completedCount ? perHole.reduce((s, r) => s + (r.complete ? r.aPts : 0), 0).toFixed(1) : 0}
                    </td>
                  </tr>

                  {/* Team B player rows */}
                  {tB?.playerIds?.map((pid, idx) => (
                    <tr key={pid || idx}>
                      <td style={{ border: '1px solid #ccc', padding: 6 }}>
                        {(players.find(p => p.id === pid)?.name) || (idx === 0 ? 'B Player 1' : 'B Player 2')}
                      </td>
                      {Array.from({ length: 18 }).map((_, h) => {
                        const v = (scoresByCourse[courseKey] || {})[pid]?.[h] ?? ''
                        const color = colorForRelative(v, parArr[h])
                        return (
                          <td key={h} style={{ border: '1px solid #ccc', padding: 6, backgroundColor: holeBgForPar(parArr[h]) }}>
                            <input
                              inputMode='numeric' pattern='[0-9]*'
                              value={v}
                              onChange={(e) => setScore(pid, h, e.target.value.replace(/[^0-9]/g, ''))}
                              style={{ width: 48, textAlign: 'center', color }}
                            />
                          </td>
                        )
                      })}
                      <td style={{ border: '1px solid #ccc', padding: 6, textAlign: 'center', fontWeight: 600 }}>
                        {(scoresByCourse[courseKey]?.[pid] || empty18()).reduce((s, v) => s + (Number(v) || 0), 0)}
                      </td>
                    </tr>
                  ))}

                  {/* Team B combined row (value + per-hole points) */}
                  <tr>
                    <td style={{ border: '1px solid #ccc', padding: 6, fontWeight: 600 }}>{tB?.name || 'Team B'}</td>
                    {Array.from({ length: 18 }).map((_, i) => {
                      const val = teamRowB[i]
                      const pts = perHole[i].complete ? perHole[i].bPts : 0
                      const n = Number(val)
                      const basis = (m.mode === "aggregate") ? parArr[i] * 2 : parArr[i]
                      const colored = Number.isFinite(n) && (m.mode === "bestball" || m.mode === "skins" || m.mode === "aggregate")
                      return (
                        <td key={i} style={{ border: '1px solid #ccc', padding: 6, backgroundColor: holeBgForPar(parArr[i]), textAlign: 'center' }}>
                          <div style={{ lineHeight: 1.1 }}>
                            {colored ? <span style={{ color: colorForRelative(n, basis) }}>{String(val)}</span> : <span>{String(val)}</span>}
                            <div style={{ fontSize: 12, color: '#374151' }}>({Number(pts).toFixed(1)})</div>
                          </div>
                        </td>
                      )
                    })}
                    <td style={{ border: '1px solid #ccc', padding: 6, textAlign: 'center', fontWeight: 700 }}>
                      {completedCount ? perHole.reduce((s, r) => s + (r.complete ? r.bPts : 0), 0).toFixed(1) : 0}
                    </td>
                  </tr>

                  {/* Per-hole result blurb + match status */}
                  <tr>
                    <td style={{ border: '1px solid #ccc', padding: 6, color: '#374151' }}>Result</td>
                    {perHole.map((r, i) => (
                      <td key={i} style={{
                        border: '1px solid #ccc', padding: 6,
                        backgroundColor: holeBgForPar(parArr[i]),
                        textAlign: 'center', fontSize: 12, color: '#374151'
                      }}>
                        {r.complete ? r.info : '—'}
                      </td>
                    ))}
                    <td style={{ border: '1px solid #ccc', padding: 6, textAlign: 'center', fontWeight: 600 }}>
                      {completedCount === 0
                        ? 'No scores yet'
                        : (totals.a > totals.b
                            ? `${tA?.name || 'A'} up ${(totals.a - totals.b).toFixed(1)}`
                            : totals.b > totals.a
                              ? `${tB?.name || 'B'} up ${(totals.b - totals.a).toFixed(1)}`
                              : 'All square')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {/* Overall records (W-L-T across completed matches only) */}
      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 12, marginTop: 12, background: '#fff' }}>
        <h3>Overall Records (completed matches)</h3>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {teams.map(t => {
            const r = teamRecords.get(t.id) || { w: 0, l: 0, t: 0 }
            return (
              <div key={t.id} style={{ padding: '6px 10px', border: '1px solid #eee', borderRadius: 8 }}>
                {t.name}: {r.w}-{r.l}-{r.t}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
