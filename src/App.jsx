import React, { useEffect, useMemo, useState, useRef } from 'react'
import { db } from './firebase'
import { doc, setDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'

/** ----------------- Courses (par per hole) ----------------- */
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

/** ----------------- Helpers ----------------- */
const empty18 = () => Array.from({ length: 18 }, () => "")
const uid = () => Math.random().toString(36).slice(2, 9)
const nowStr = (ms) => new Date(ms).toLocaleString()

/** Color-blind safe palette for score coloring (relative to par) */
function colorForRelative(score, par) {
  const n = Number(score)
  if (!Number.isFinite(n)) return "var(--ink)"
  const d = n - par
  if (d <= -3) return "#5B2D8F" // albatross
  if (d === -2) return "#0072B2" // eagle
  if (d === -1) return "#009E73" // birdie
  if (d ===  0) return "var(--ink)" // par
  if (d ===  1) return "#E69F00" // bogey
  if (d >=  3) return "#7F0000" // triple+
  return "#D55E00" // double
}
function holeBgForPar(par) {
  if (par === 3) return "#f7f7f7"
  if (par === 5) return "#efefef"
  return "#ffffff"
}

/** Safe URL & storage helpers */
function safeTripIdFromUrl() {
  try {
    const url = new URL(window.location.href)
    return url.searchParams.get('trip') || ''
  } catch { return '' }
}
function setTripIdInUrl(id) {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('trip', id)
    window.history.replaceState({}, '', url.toString())
  } catch {}
}
function safeGetLocal(k) {
  try { return localStorage.getItem(k) } catch { return null }
}
function safeSetLocal(k, v) {
  try { localStorage.setItem(k, v) } catch {}
}

/** ----------------- App ----------------- */
export default function App() {
  // Device/ownership (computed after mount)
  const [deviceId, setDeviceId] = useState('')
  useEffect(() => {
    let v = safeGetLocal('deviceId')
    if (!v) { v = uid()+uid(); safeSetLocal('deviceId', v) }
    setDeviceId(v || ('dev_'+uid()))
  }, [])

  // Core state
  const [tripId, setTripId] = useState(safeTripIdFromUrl())
  const [players, setPlayers] = useState([]) // {id, name}
  const [teams, setTeams] = useState([])     // {id, name, playerIds:[p1,p2]}
  const [matches, setMatches] = useState([]) // live matches
  const [history, setHistory] = useState([]) // archived matches
  const [courseKey, setCourseKey] = useState(COURSES[0].key)
  const [scoresByCourse, setScoresByCourse] = useState({ hiawatha: {}, enjoie: {}, conklin: {} })

  // Meta / UX
  const [connected, setConnected] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [view, setView] = useState('live') // 'live' | 'history'
  const [showQR, setShowQR] = useState(false)

  // Room security
  const [ownerDeviceId, setOwnerDeviceId] = useState('')
  const [pinEnabled, setPinEnabled] = useState(false)
  const [pin, setPin] = useState('')
  const [enteredPin, setEnteredPin] = useState(safeGetLocal('tripAuth:'+safeTripIdFromUrl()) || '')

  // Preferences
  const [bigType, setBigType] = useState(safeGetLocal('prefBigType') === '1')
  const [highContrast, setHighContrast] = useState(safeGetLocal('prefHighContrast') === '1')

  // Score typing concurrency protection
  const scoresDirtyRef = useRef(false)
  const latestRef = useRef({ players, teams, matches, history, courseKey, scoresByCourse, pinEnabled, pin, ownerDeviceId })
  useEffect(() => { latestRef.current = { players, teams, matches, history, courseKey, scoresByCourse, pinEnabled, pin, ownerDeviceId } },
    [players, teams, matches, history, courseKey, scoresByCourse, pinEnabled, pin, ownerDeviceId])

  // Online/offline listeners
  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const course = COURSES.find(c => c.key === courseKey) || COURSES[0]
  const parArr = course.par

  /** ----------------- Design tokens ----------------- */
  const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
  :root {
    --font: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji';
    --ink: #000;
    --muted: #6b7280;
    --bg: #fff;
    --card: #fff;
    --border: ${highContrast ? '#000' : '#e5e7eb'};
    --shadow: ${highContrast ? 'none' : '0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.08)'};
    --radius: 14px;
    --space: 12px;
    --scale: ${bigType ? 1.15 : 1};
  }
  * { box-sizing: border-box }
  html, body { background: var(--bg); color: var(--ink); font-family: var(--font); }
  body { font-size: calc(16px * var(--scale)); }
  button, input, select { font-size: calc(16px * var(--scale)); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: var(--space); }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap: var(--space); }
  .card { border:1px solid var(--border); border-radius: var(--radius); padding: var(--space); background: var(--card); box-shadow: var(--shadow); }
  .tableWrap { overflow-x:auto }
  .score { width:52px; height:40px; text-align:center; border:1px solid var(--border); border-radius: 10px; }
  .stickyHeader { position:sticky; top:0; background:var(--bg); z-index:3; padding:8px 0; border-bottom: 1px solid var(--border) }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap }
  .pill { padding:6px 10px; border:1px solid var(--border); border-radius: 999px; background:#fff }
  .btn { padding:6px 10px; border:1px solid var(--border); border-radius: 10px; background:#fff; cursor:pointer }
  .btn[disabled] { opacity:.5; cursor:not-allowed }
  .tabs { display:flex; gap:8px; margin-top:8px }
  .tab { padding:6px 10px; border:1px solid var(--border); border-radius: 999px; background:#fff; cursor:pointer }
  .tab.active { border-color:#111; font-weight:600 }
  .qrModal { position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex; align-items:center; justify-content:center; z-index:50 }
  .qrCard { background:#fff; padding:16px; border-radius: var(--radius); border:1px solid var(--border) }
  @media (max-width: 860px) {
    .grid3 { grid-template-columns:1fr }
    .score { width:44px; height:38px }
    th, td { padding:6px }
  }`

  /** ----------------- Firestore subscribe ----------------- */
  useEffect(() => {
    if (!tripId) return
    const ref = doc(db, 'trips', tripId)
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return
      const d = snap.data()
      setPlayers(d.players || [])
      setTeams(d.teams || [])
      setMatches(d.matches || [])
      setHistory(d.history || [])
      setCourseKey(d.courseKey || COURSES[0].key)
      setOwnerDeviceId(d.ownerDeviceId || '')
      setPinEnabled(!!d.pinEnabled)
      setPin(d.pin || '')
      if (!scoresDirtyRef.current) {
        setScoresByCourse(d.scoresByCourse || { hiawatha: {}, enjoie: {}, conklin: {} })
      }
      setConnected(true)
    })
    return () => unsub()
  }, [tripId])

  /** ----------------- Create room ----------------- */
  async function createTrip() {
    const newId = uid() + uid()
    const ref = doc(db, 'trips', newId)
    const myDevice = deviceId || (safeGetLocal('deviceId') || ('dev_'+uid()))
    const init = {
      createdAt: serverTimestamp(),
      ownerDeviceId: myDevice,
      pinEnabled: false,
      pin: "",
      players: [], teams: [], matches: [], history: [],
      courseKey: COURSES[0].key,
      scoresByCourse: { hiawatha: {}, enjoie: {}, conklin: {} },
      updatedAt: serverTimestamp(),
    }
    await setDoc(ref, init)
    setTripId(newId)
    setTripIdInUrl(newId)
    setOwnerDeviceId(myDevice)
  }

  /** ----------------- Save helpers + local draft ----------------- */
  const writeTimer = useRef(null)
  function saveLocalDraft(cur) {
    try { localStorage.setItem('draft:'+tripId, JSON.stringify({ ts: Date.now(), data: cur })) } catch {}
  }
  function scheduleDebouncedSave(overrides = {}) {
    if (!tripId) return
    scoresDirtyRef.current = true
    setSaving(true)
    clearTimeout(writeTimer.current)
    writeTimer.current = setTimeout(async () => {
      const cur = { ...latestRef.current, ...overrides }
      saveLocalDraft(cur)
      try {
        if (!navigator.onLine) throw new Error('offline')
        await updateDoc(doc(db, 'trips', tripId), { ...cur, updatedAt: serverTimestamp() })
        scoresDirtyRef.current = false
        setSaving(false)
      } catch {
        setSaving(false) // stays in local draft
      }
    }, 250)
  }
  async function saveNowAll(overrides = {}) {
    if (!tripId) return
    const cur = { ...latestRef.current, ...overrides }
    setPlayers(cur.players); setTeams(cur.teams); setMatches(cur.matches)
    setHistory(cur.history); setCourseKey(cur.courseKey); setScoresByCourse(cur.scoresByCourse)
    setPinEnabled(cur.pinEnabled); setPin(cur.pin); setOwnerDeviceId(cur.ownerDeviceId)
    setSaving(true)
    saveLocalDraft(cur)
    try {
      if (!navigator.onLine) throw new Error('offline')
      await updateDoc(doc(db, 'trips', tripId), { ...cur, updatedAt: serverTimestamp() })
      setSaving(false)
    } catch { setSaving(false) }
  }
  // Flush local draft when back online
  useEffect(() => {
    if (!tripId || !isOnline) return
    const draft = safeGetLocal('draft:'+tripId)
    if (draft) {
      try { const d = JSON.parse(draft).data; updateDoc(doc(db, 'trips', tripId), { ...d, updatedAt: serverTimestamp() }) } catch {}
    }
  }, [isOnline, tripId])

  /** ----------------- Authorization ----------------- */
  const isOwner = ownerDeviceId && ownerDeviceId === deviceId
  const isEditor = isOwner || !pinEnabled || (enteredPin && pin && enteredPin === pin)
  useEffect(() => {
    if (isEditor && tripId) safeSetLocal('tripAuth:'+tripId, enteredPin || 'owner')
  }, [isEditor, enteredPin, tripId])

  /** ----------------- Players / Teams ----------------- */
  const assignedPlayerIds = useMemo(
    () => new Set(teams.flatMap(t => (t.playerIds || []).filter(Boolean))),
    [teams]
  )
  const addPlayer = async (name = "") => {
    const p = { id: uid(), name: name || `Player ${players.length + 1}` }
    const nextPlayers = [...players, p]
    const perCourse = { ...(scoresByCourse[courseKey] || {}), [p.id]: empty18() }
    const nextScores = { ...scoresByCourse, [courseKey]: perCourse }
    await saveNowAll({ players: nextPlayers, scoresByCourse: nextScores })
  }
  const renamePlayer = async (id, name) => { await saveNowAll({ players: players.map(p => p.id === id ? { ...p, name } : p) }) }
  const removePlayer = async (id) => {
    const nextPlayers = players.filter(p => p.id !== id)
    const nextTeams = teams.map(t => ({ ...t, playerIds: (t.playerIds || []).map(pid => pid === id ? "" : pid) }))
    const perCourse = { ...(scoresByCourse[courseKey] || {}) }; delete perCourse[id]
    const nextScores = { ...scoresByCourse, [courseKey]: perCourse }
    await saveNowAll({ players: nextPlayers, teams: nextTeams, scoresByCourse: nextScores })
  }

  const addTeam = async () => { await saveNowAll({ teams: [...teams, { id: uid(), name: `Team ${teams.length + 1}`, playerIds: ["",""] }] }) }
  const setTeamName = async (id, name) => { await saveNowAll({ teams: teams.map(t => t.id === id ? { ...t, name } : t) }) }
  const assignPlayer = async (teamId, slotIdx, newPid) => {
    let nextTeams
    if (!newPid) {
      nextTeams = teams.map(t => t.id === teamId ? { ...t, playerIds: Object.assign([], t.playerIds, { [slotIdx]: "" }) } : t)
    } else {
      const cleared = teams.map(t => ({ ...t, playerIds: (t.playerIds || []).map(pid => pid === newPid ? "" : pid) }))
      nextTeams = cleared.map(t => t.id === teamId ? { ...t, playerIds: Object.assign([], t.playerIds, { [slotIdx]: newPid }) } : t)
    }
    await saveNowAll({ teams: nextTeams })
  }
  const removeTeam = async (id) => {
    const nextTeams = teams.filter(t => t.id !== id)
    const nextMatches = matches.filter(m => m.teamAId !== id && m.teamBId !== id)
    await saveNowAll({ teams: nextTeams, matches: nextMatches })
  }

  /** ----------------- Matches ----------------- */
  const addMatch = async () => { await saveNowAll({ matches: [...matches, { id: uid(), teamAId: "", teamBId: "", mode: MODES[0].id }] }) }
  const removeMatch = async (mid) => { await saveNowAll({ matches: matches.filter(m => m.id !== mid) }) }
  const setMatchField = async (mid, field, value) => { await saveNowAll({ matches: matches.map(m => m.id === mid ? { ...m, [field]: value } : m) }) }

  /** ----------------- Scores ----------------- */
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
      scoresDirtyRef.current = true
      scheduleDebouncedSave({ scoresByCourse: next })
      return next
    })
  }
  const getScore = (pid, h) => {
    const v = (scoresByCourse[courseKey] || {})[pid]?.[h]
    if (v === "" || v === null || v === undefined) return NaN
    const n = Number(v); return Number.isFinite(n) ? n : NaN
  }

  /** ----------------- Per-hole computation (live) ----------------- */
  function computeHole(modeId, h, A, B, parArray) {
    if (!A || !B) return { aPts: 0, bPts: 0, info: "Pick two teams", complete: false }
    const [a1, a2] = A.playerIds || [], [b1, b2] = B.playerIds || []
    if (!a1 || !a2 || !b1 || !b2) return { aPts: 0, bPts: 0, info: "Both teams need two players", complete: false }
    const aS = [getScore(a1, h), getScore(a2, h)]
    const bS = [getScore(b1, h), getScore(b2, h)]
    if (aS.some(Number.isNaN) || bS.some(Number.isNaN)) return { aPts: 0, bPts: 0, info: "Waiting for scores", complete: false }

    const tie = 0.5, par = parArray[h]
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
      const aCapS = aS[0], aMateS = aS[1], bCapS = bS[0], bMateS = bS[1]
      let aPts = 0, bPts = 0
      if (aCapS < bCapS) aPts += 1; else if (bCapS < aCapS) bPts += 1; else { aPts += tie; bPts += tie }
      if (aMateS < bMateS) aPts += 1; else if (bMateS < aMateS) bPts += 1; else { aPts += tie; bPts += tie }
      return { aPts, bPts, info: `Cap ${aCapS}/${bCapS}, Mate ${aMateS}/${bMateS}`, complete: true }
    }
    if (modeId === "stableford") {
      const sp = (sc, p) => { const d = sc - p; if (d <= -3) return 5; if (d === -2) return 4; if (d === -1) return 3; if (d === 0) return 2; if (d === 1) return 1; return 0 }
      const aPtsS = sp(aS[0], par) + sp(aS[1], par)
      const bPtsS = sp(bS[0], par) + sp(bS[1], par)
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
  function applySkinsCarry(perHole) {
    let carry = 0
    return perHole.map((r) => {
      if (!r.complete) return { ...r, aPts: 0, bPts: 0, info: r.info + (carry ? ` (carry ${carry})` : "") }
      if (r.aPts === 0 && r.bPts === 0) { carry += 1; return { ...r, aPts: 0, bPts: 0, info: `Skin halved${carry ? ` (carry ${carry})` : ""}` } }
      if (r.aPts > r.bPts)  { const pts = carry + 1; carry = 0; return { ...r, aPts: pts, bPts: 0, info: `Skin A x${pts}` } }
      if (r.bPts > r.aPts)  { const pts = carry + 1; carry = 0; return { ...r, aPts: 0, bPts: pts, info: `Skin B x${pts}` } }
      return r
    })
  }
  function teamValue(modeId, h, T, parArray) {
    if (!T) return "-"
    const [p1, p2] = T.playerIds || []
    const s1 = getScore(p1, h), s2 = getScore(p2, h)
    if ([s1, s2].some(Number.isNaN)) return "-"
    if (modeId === "bestball" || modeId === "skins") return Math.min(s1, s2)
    if (modeId === "aggregate")  return s1 + s2
    if (modeId === "highlow")    return `${Math.min(s1, s2)}/${Math.max(s1, s2)}`
    if (modeId === "captainmate")return `${s1}/${s2}`
    if (modeId === "stableford") {
      const sp = (sc, p) => { const d = sc - p; if (d <= -3) return 5; if (d === -2) return 4; if (d === -1) return 3; if (d === 0) return 2; if (d === 1) return 1; return 0 }
      return sp(s1, parArray[h]) + sp(s2, parArray[h])
    }
    return "-"
  }

  /** ----------------- History compute (read archived scores only) ----------------- */
  const getHistScore = (hist, pid, h) => {
    const v = hist.scores?.[pid]?.[h]
    const n = Number(v); return Number.isFinite(n) ? n : NaN
  }
  function computeHoleHist(hist, h) {
    const parArray = (COURSES.find(c => c.key === hist.courseKey)?.par) || COURSES[0].par
    const [a1, a2] = hist.teamA.playerIds || [], [b1, b2] = hist.teamB.playerIds || []
    if (!a1 || !a2 || !b1 || !b2) return { aPts: 0, bPts: 0, info: "—", complete: false }

    const aS = [getHistScore(hist, a1, h), getHistScore(hist, a2, h)]
    const bS = [getHistScore(hist, b1, h), getHistScore(hist, b2, h)]
    if (aS.some(Number.isNaN) || bS.some(Number.isNaN)) return { aPts: 0, bPts: 0, info: "—", complete: false }

    const modeId = hist.mode, tie = 0.5, par = parArray[h]
    if (modeId === "bestball") {
      const aBest = Math.min(...aS), bBest = Math.min(...bS)
      if (aBest < bBest) return { aPts: 1, bPts: 0, info: "", complete: true }
      if (bBest < aBest) return { aPts: 0, bPts: 1, info: "", complete: true }
      return { aPts: tie, bPts: tie, info: "", complete: true }
    }
    if (modeId === "aggregate") {
      const aTot = aS[0] + aS[1], bTot = bS[0] + bS[1]
      if (aTot < bTot) return { aPts: 1, bPts: 0, info: "", complete: true }
      if (bTot < aTot) return { aPts: 0, bPts: 1, info: "", complete: true }
      return { aPts: tie, bPts: tie, info: "", complete: true }
    }
    if (modeId === "highlow") {
      let aPts = 0, bPts = 0
      const aLow = Math.min(...aS), aHigh = Math.max(...aS)
      const bLow = Math.min(...bS), bHigh = Math.max(...bS)
      if (aLow < bLow) aPts += 1; else if (bLow < aLow) bPts += 1; else { aPts += tie; bPts += tie }
      if (aHigh < bHigh) aPts += 1; else if (bHigh < aHigh) bPts += 1; else { aPts += tie; bPts += tie }
      return { aPts, bPts, info: "", complete: true }
    }
    if (modeId === "captainmate") {
      let aPts = 0, bPts = 0
      if (aS[0] < bS[0]) aPts += 1; else if (bS[0] < aS[0]) bPts += 1; else { aPts += tie; bPts += tie }
      if (aS[1] < bS[1]) aPts += 1; else if (bS[1] < aS[1]) bPts += 1; else { aPts += tie; bPts += tie }
      return { aPts, bPts, info: "", complete: true }
    }
    if (modeId === "stableford") {
      const sp = (sc) => { const d = sc - par; if (d <= -3) return 5; if (d === -2) return 4; if (d === -1) return 3; if (d === 0) return 2; if (d === 1) return 1; return 0 }
      const aPtsS = sp(aS[0]) + sp(aS[1])
      const bPtsS = sp(bS[0]) + sp(bS[1])
      if (aPtsS > bPtsS) return { aPts: 1, bPts: 0, info: "", complete: true }
      if (bPtsS > aPtsS) return { aPts: 0, bPts: 1, info: "", complete: true }
      return { aPts: 0.5, bPts: 0.5, info: "", complete: true }
    }
    if (modeId === "skins") {
      const aBest = Math.min(...aS), bBest = Math.min(...bS)
      if (aBest < bBest) return { aPts: 1, bPts: 0, info: "", complete: true }
      if (bBest < aBest) return { aPts: 0, bPts: 1, info: "", complete: true }
      return { aPts: 0, bPts: 0, info: "", complete: true }
    }
    return { aPts: 0, bPts: 0, info: "", complete: false }
  }
  function applySkinsCarryHist(perHole) {
    let carry = 0
    return perHole.map((r) => {
      if (!r.complete) return { ...r, aPts: 0, bPts: 0 }
      if (r.aPts === 0 && r.bPts === 0) { carry += 1; return { ...r, aPts: 0, bPts: 0 } }
      if (r.aPts > r.bPts)  { const pts = carry + 1; carry = 0; return { ...r, aPts: pts, bPts: 0 } }
      if (r.bPts > r.aPts)  { const pts = carry + 1; carry = 0; return { ...r, aPts: 0, bPts: pts } }
      return r
    })
  }

  /** ----------------- Archive & History actions ----------------- */
  async function saveMatchToHistory(mid) {
    const m = matches.find(x => x.id === mid); if (!m) return
    const tA = teams.find(t => t.id === m.teamAId), tB = teams.find(t => t.id === m.teamBId)
    if (!tA || !tB) return
    const ids = [...(tA.playerIds||[]), ...(tB.playerIds||[])].filter(Boolean)
    const scoresSnap = {}; const courseMap = scoresByCourse[courseKey] || {}
    ids.forEach(pid => { scoresSnap[pid] = [...(courseMap[pid] || empty18())] })
    const histItem = {
      id: uid(),
      savedAt: Date.now(),
      label: `Match • ${COURSES.find(c=>c.key===courseKey)?.name || 'Course'} • ${tA.name} vs ${tB.name}`,
      courseKey,
      mode: m.mode,
      teamA: { id: tA.id, name: tA.name, playerIds: [...(tA.playerIds||[])],
               playerNames: (tA.playerIds||[]).map(pid => players.find(p=>p.id===pid)?.name || "") },
      teamB: { id: tB.id, name: tB.name, playerIds: [...(tB.playerIds||[])],
               playerNames: (tB.playerIds||[]).map(pid => players.find(p=>p.id===pid)?.name || "") },
      scores: scoresSnap,
    }
    await saveNowAll({ history: [...history, histItem], matches: matches.filter(x=>x.id!==mid) })
    setView('history')
  }
  async function deleteHistory(hid) { await saveNowAll({ history: history.filter(h => h.id !== hid) }) }
  async function renameHistory(hid, label) { await saveNowAll({ history: history.map(h => h.id === hid ? { ...h, label } : h) }) }
  async function restoreHistory(hid) {
    const h = history.find(x => x.id === hid); if (!h) return
    // Ensure players exist
    const allIds = [...h.teamA.playerIds, ...h.teamB.playerIds]
    let nextPlayers = [...players]
    for (const pid of allIds) {
      if (!nextPlayers.find(p => p.id === pid)) {
        const name =
          (h.teamA.playerIds.includes(pid) ? h.teamA.playerNames[h.teamA.playerIds.indexOf(pid)] :
           h.teamB.playerNames[h.teamB.playerIds.indexOf(pid)]) || `Player`
        nextPlayers.push({ id: pid, name })
      }
    }
    // Ensure teams exist (same IDs)
    let nextTeams = [...teams]
    const ensureTeam = (t) => {
      if (!nextTeams.find(x => x.id === t.id)) nextTeams.push({ id: t.id, name: t.name, playerIds: [...t.playerIds] })
      else nextTeams = nextTeams.map(x => x.id === t.id ? { ...x, name: t.name, playerIds: [...t.playerIds] } : x)
    }
    ensureTeam(h.teamA); ensureTeam(h.teamB)
    // Merge scores
    const nextScores = { ...scoresByCourse }
    const perCourse = { ...(nextScores[h.courseKey] || {}) }
    for (const pid of allIds) { perCourse[pid] = [...(h.scores?.[pid] || empty18())] }
    nextScores[h.courseKey] = perCourse
    // Add live match
    const nextMatches = [...matches, { id: uid(), teamAId: h.teamA.id, teamBId: h.teamB.id, mode: h.mode }]
    await saveNowAll({ players: nextPlayers, teams: nextTeams, matches: nextMatches, scoresByCourse: nextScores, courseKey: h.courseKey })
    setView('live')
  }

  /** ----------------- Exports ----------------- */
  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }
  function exportHistoryJSON(h) { downloadText(`${h.label.replaceAll(' ','_')}.json`, JSON.stringify(h, null, 2)) }
  function exportHistoryCSV(h) {
    const courseName = COURSES.find(c => c.key === h.courseKey)?.name || 'Course'
    const parArray = (COURSES.find(c => c.key === h.courseKey)?.par) || COURSES[0].par
    let perHole = Array.from({ length: 18 }, (_, i) => computeHoleHist(h, i))
    if (h.mode === 'skins') perHole = applySkinsCarryHist(perHole)
    const [a1,a2] = h.teamA.playerIds, [b1,b2] = h.teamB.playerIds
    const a1n = h.teamA.playerNames?.[0] || 'A1', a2n = h.teamA.playerNames?.[1] || 'A2'
    const b1n = h.teamB.playerNames?.[0] || 'B1', b2n = h.teamB.playerNames?.[1] || 'B2'
    const header = [
      `Course: ${courseName}`, `Mode: ${h.mode}`, `${h.teamA.name} vs ${h.teamB.name}`, `Saved: ${nowStr(h.savedAt)}`
    ].join('\n')
    const cols = ['Hole','Par',a1n,a2n,b1n,b2n,'A pts','B pts']
    const lines = [cols.join(',')]
    for (let i=0;i<18;i++) {
      const r = perHole[i]
      const row = [
        i+1,
        parArray[i],
        h.scores?.[a1]?.[i] || '',
        h.scores?.[a2]?.[i] || '',
        h.scores?.[b1]?.[i] || '',
        h.scores?.[b2]?.[i] || '',
        (r.complete ? r.aPts : 0),
        (r.complete ? r.bPts : 0),
      ]
      lines.push(row.join(','))
    }
    downloadText(`${h.label.replaceAll(' ','_')}.csv`, header + '\n\n' + lines.join('\n'))
  }
  function printHistory(h) {
    const courseName = COURSES.find(c => c.key === h.courseKey)?.name || 'Course'
    const parArray = (COURSES.find(c => c.key === h.courseKey)?.par) || COURSES[0].par
    let perHole = Array.from({ length: 18 }, (_, i) => computeHoleHist(h, i))
    if (h.mode === 'skins') perHole = applySkinsCarryHist(perHole)
    const win = window.open('', '_blank')
    const style = `
      <style>
        body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#000; }
        table { border-collapse: collapse; width:100% }
        th, td { border:1px solid #000; padding:4px; text-align:center }
        h2 { margin: 8px 0 }
      </style>`
    const head = `<h2>${h.label}</h2><div>${courseName} • ${nowStr(h.savedAt)}</div>`
    const headerRow = Array.from({length:18}).map((_,i)=>`<th>H${i+1}</th>`).join('')
    const parRow = parArray.map(p=>`<td>${p}</td>`).join('')
    const rowFor = (pidArr, names) => {
      return pidArr.map((pid, idx) => `
        <tr><td>${names?.[idx] || ''}</td>${Array.from({length:18}).map((_,i)=>`<td>${h.scores?.[pid]?.[i] ?? ''}</td>`).join('')}<td>${(h.scores?.[pid]||[]).reduce((s,v)=>s+(Number(v)||0),0)}</td></tr>
      `).join('')
    }
    const aPts = perHole.map(r => r.complete ? r.aPts : 0).join('</td><td>')
    const bPts = perHole.map(r => r.complete ? r.bPts : 0).join('</td><td>')
    const html = `
      ${style}${head}
      <table>
        <thead><tr><th>Row</th>${headerRow}<th>Total</th></tr></thead>
        <tbody>
          <tr><td>Par</td>${parRow}<td>${parArray.reduce((a,b)=>a+b,0)}</td></tr>
          ${rowFor(h.teamA.playerIds, h.teamA.playerNames)}
          <tr><td><b>${h.teamA.name}</b></td><td>${aPts}</td><td><b>${perHole.reduce((s,r)=>s+(r.complete?r.aPts:0),0).toFixed(1)}</b></td></tr>
          ${rowFor(h.teamB.playerIds, h.teamB.playerNames)}
          <tr><td><b>${h.teamB.name}</b></td><td>${bPts}</td><td><b>${perHole.reduce((s,r)=>s+(r.complete?r.bPts:0),0).toFixed(1)}</b></td></tr>
        </tbody>
      </table>`
    win.document.write(html); win.document.close(); win.focus(); win.print()
  }

  /** ----------------- UI ----------------- */
  if (!tripId) {
    return (
      <div className="wrap">
        <style>{css}</style>
        <h1>Golf Trip App</h1>
        <p>Create a shared room so everyone can enter scores from their phones.</p>
        <button className="btn" onClick={createTrip}>Create Room</button>
        <p style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          After creating, share the URL (it will contain <code>?trip=&lt;id&gt;</code>).
        </p>
      </div>
    )
  }

  const assignedSet = assignedPlayerIds
  const statusChip = isOnline ? (saving ? 'Syncing…' : 'Saved') : 'Offline: saving locally'
  const canEdit = (ownerDeviceId && ownerDeviceId === deviceId) || !pinEnabled || (enteredPin && pin && enteredPin === pin)

  return (
    <div className="wrap">
      <style>{css}</style>

      <header className="stickyHeader">
        <div className="row" style={{ justifyContent:'space-between' }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>Golf Trip</h2>
            <span className="pill">Room: <code>{tripId}</code></span>
            <span className="pill">{connected ? 'Connected ✅' : 'Connecting…'}</span>
            <span className="pill">{statusChip}</span>
          </div>
          <div className="row">
            <button className="btn" onClick={() => {
              const url = window.location.href
              if (navigator.share) navigator.share({ title:'Golf Trip', url }).catch(()=>{})
              else { navigator.clipboard?.writeText(url); alert('Link copied') }
            }}>Share link</button>
            <button className="btn" onClick={() => setShowQR(true)}>QR</button>
            <button className={`tab ${view==='live'?'active':''}`} onClick={()=>setView('live')}>Live</button>
            <button className={`tab ${view==='history'?'active':''}`} onClick={()=>setView('history')}>History</button>
          </div>
        </div>

        <div className="row" style={{ marginTop: 6 }}>
          <select
            value={courseKey} disabled={!canEdit}
            onChange={async (e) => { await saveNowAll({ courseKey: e.target.value }) }}>
            {COURSES.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>

          <label className="pill" style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={bigType} onChange={e => { setBigType(e.target.checked); safeSetLocal('prefBigType', e.target.checked ? '1':'0') }} />
            Big type
          </label>
          <label className="pill" style={{ display:'flex', gap:6, alignItems:'center' }}>
            <input type="checkbox" checked={highContrast} onChange={e => { setHighContrast(e.target.checked); safeSetLocal('prefHighContrast', e.target.checked ? '1':'0') }} />
            High contrast
          </label>

          {/* PIN controls */}
          {(ownerDeviceId && ownerDeviceId === deviceId) ? (
            <div className="row" style={{ marginLeft:'auto' }}>
              <label className="pill" style={{ display:'flex', gap:6, alignItems:'center' }}>
                <input type="checkbox" checked={pinEnabled} onChange={e => saveNowAll({ pinEnabled: e.target.checked })} />
                Require PIN to edit
              </label>
              <input className="score" maxLength={4} placeholder="PIN"
                value={pin} onChange={(e)=>saveNowAll({ pin: e.target.value.replace(/[^0-9]/g,'').slice(0,4) })} />
            </div>
          ) : pinEnabled && !canEdit ? (
            <div className="row" style={{ marginLeft:'auto' }}>
              <input className="score" maxLength={4} placeholder="Enter PIN"
                value={enteredPin} onChange={(e)=>setEnteredPin(e.target.value.replace(/[^0-9]/g,'').slice(0,4))} />
              <button className="btn" onClick={()=>{ /* recompute canEdit via state change */ }}>Unlock</button>
            </div>
          ) : null}
        </div>
      </header>

      {/* QR Modal */}
      {showQR && (
        <div className="qrModal" onClick={()=>setShowQR(false)}>
          <div className="qrCard" onClick={e=>e.stopPropagation()}>
            <h3 style={{ marginTop:0 }}>Scan to join</h3>
            <img alt="Join QR" width={220} height={220}
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(window.location.href)}`} />
            <div style={{ textAlign:'right', marginTop:8 }}>
              <button className="btn" onClick={()=>setShowQR(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {view === 'live' && (
        <>
          {/* Setup */}
          <section className="grid3" style={{ marginTop: 12 }}>
            <div className="card">
              <h3>Players</h3>
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                {players.map(p => (
                  <div key={p.id} className="row" style={{ marginBottom: 6 }}>
                    <input value={p.name} disabled={!canEdit} onChange={(e) => renamePlayer(p.id, e.target.value)} />
                    <button className="btn" disabled={!canEdit} onClick={() => removePlayer(p.id)}>Remove</button>
                  </div>
                ))}
              </div>
              <button className="btn" disabled={!canEdit} onClick={() => addPlayer()}>Add player</button>
            </div>

            <div className="card">
              <h3>Teams</h3>
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                {teams.map(t => {
                  const current = new Set(t.playerIds || [])
                  return (
                    <div key={t.id} style={{ border:'1px solid var(--border)', borderRadius:10, padding:8, marginBottom:8 }}>
                      <div className="row">
                        <input value={t.name} disabled={!canEdit} onChange={(e)=>setTeamName(t.id, e.target.value)} />
                        <button className="btn" disabled={!canEdit} onClick={()=>removeTeam(t.id)}>Remove</button>
                      </div>
                      <div className="row" style={{ gap:8, marginTop:8 }}>
                        {[0,1].map(slot => (
                          <select key={slot} disabled={!canEdit} value={t.playerIds?.[slot] || ''} onChange={e=>assignPlayer(t.id, slot, e.target.value)}>
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
              <button className="btn" disabled={!canEdit} onClick={addTeam}>Add team</button>
            </div>

            <div className="card">
              <h3>Matches</h3>
              <button className="btn" disabled={!canEdit} onClick={addMatch}>Add match</button>
              <div style={{ fontSize: 12, color:'var(--muted)', marginTop: 6 }}>
                Each match has its own mode. A team can only play one match at a time, and can’t face itself.
              </div>
            </div>
          </section>

          {/* Scorecards */}
          {matches.map((m) => {
            const tA = teams.find(t => t.id === m.teamAId)
            const tB = teams.find(t => t.id === m.teamBId)

            const inUseElsewhere = new Set(
              matches.filter(x => x.id !== m.id).flatMap(x => [x.teamAId, x.teamBId].filter(Boolean))
            )
            const teamOptionsA = teams.filter(t => !inUseElsewhere.has(t.id) && t.id !== m.teamBId)
            const teamOptionsB = teams.filter(t => !inUseElsewhere.has(t.id) && t.id !== m.teamAId)

            let perHole = Array.from({ length: 18 }, (_, h) => computeHole(m.mode, h, tA, tB, parArr))
            if (m.mode === "skins") perHole = applySkinsCarry(perHole)
            const completedCount = perHole.filter(r => r.complete).length

            const teamRowA = Array.from({ length: 18 }, (_, h) => teamValue(m.mode, h, tA, parArr))
            const teamRowB = Array.from({ length: 18 }, (_, h) => teamValue(m.mode, h, tB, parArr))
            const totalsA = perHole.reduce((s,r)=>s+(r.complete?r.aPts:0),0)
            const totalsB = perHole.reduce((s,r)=>s+(r.complete?r.bPts:0),0)

            const courseName = COURSES.find(c => c.key === courseKey)?.name
            const title = `Scorecard — ${courseName} — ${tA?.name || 'Team A'} vs ${tB?.name || 'Team B'}`
            const canSave = Boolean(tA && tB && (tA.playerIds||[])[0] && (tA.playerIds||[])[1] && (tB.playerIds||[])[0] && (tB.playerIds||[])[1])

            return (
              <section key={m.id} className="card" style={{ marginTop: 12 }}>
                <div className="row">
                  <select value={m.teamAId} disabled={!canEdit} onChange={e=>setMatchField(m.id,'teamAId',e.target.value)}>
                    <option value=''>— Select Team A —</option>
                    {teamOptionsA.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select value={m.teamBId} disabled={!canEdit} onChange={e=>setMatchField(m.id,'teamBId',e.target.value)}>
                    <option value=''>— Select Team B —</option>
                    {teamOptionsB.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select value={m.mode} disabled={!canEdit} onChange={e=>setMatchField(m.id,'mode',e.target.value)}>
                    {MODES.map(md => <option key={md.id} value={md.id}>{md.name}</option>)}
                  </select>

                  <div className="row" style={{ marginLeft:'auto' }}>
                    <button className="btn" disabled={!canEdit} onClick={()=>removeMatch(m.id)}>Remove</button>
                    <button className="btn" disabled={!canEdit || !canSave} onClick={()=>saveMatchToHistory(m.id)}>Save scorecard</button>
                  </div>
                </div>

                <h4 style={{ margin:'8px 0' }}>{title}</h4>

                <div className="tableWrap">
                  <table style={{ borderCollapse:'collapse', minWidth:940, width:'100%' }}>
                    <thead>
                      <tr>
                        <th style={{ border:'1px solid var(--border)', padding:6, textAlign:'left' }}>Row</th>
                        {Array.from({ length: 18 }).map((_, i) => (
                          <th key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[i]) }}>H{i + 1}</th>
                        ))}
                        <th style={{ border:'1px solid var(--border)', padding:6 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ border:'1px solid var(--border)', padding:6, fontWeight:600 }}>Par</td>
                        {parArr.map((p, i) => (
                          <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[i]), textAlign:'center', color:'var(--muted)' }}>{p}</td>
                        ))}
                        <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                          {parArr.reduce((a,b)=>a+b,0)}
                        </td>
                      </tr>

                      {tA?.playerIds?.map((pid, idx) => (
                        <tr key={pid || idx}>
                          <td style={{ border:'1px solid var(--border)', padding:6 }}>
                            {(players.find(p => p.id === pid)?.name) || (idx === 0 ? 'A Player 1' : 'A Player 2')}
                          </td>
                          {Array.from({ length: 18 }).map((_, h) => {
                            const v = (scoresByCourse[courseKey] || {})[pid]?.[h] ?? ''
                            const color = colorForRelative(v, parArr[h])
                            return (
                              <td key={h} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[h]) }}>
                                <input className="score" inputMode='numeric' pattern='[0-9]*'
                                  value={v} disabled={!canEdit}
                                  onChange={(e)=>setScore(pid, h, e.target.value.replace(/[^0-9]/g,''))}
                                  style={{ color }} />
                              </td>
                            )
                          })}
                          <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                            {(scoresByCourse[courseKey]?.[pid] || empty18()).reduce((s,v)=>s+(Number(v)||0),0)}
                          </td>
                        </tr>
                      ))}

                      <tr>
                        <td style={{ border:'1px solid var(--border)', padding:6, fontWeight:600 }}>{tA?.name || 'Team A'}</td>
                        {Array.from({ length: 18 }).map((_, i) => {
                          const val = teamRowA[i]
                          const pts = perHole[i].complete ? perHole[i].aPts : 0
                          const n = Number(val)
                          const basis = (m.mode === "aggregate") ? parArr[i] * 2 : parArr[i]
                          const colored = Number.isFinite(n) && (m.mode === "bestball" || m.mode === "skins" || m.mode === "aggregate")
                          return (
                            <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[i]), textAlign:'center' }}>
                              <div style={{ lineHeight:1.1 }}>
                                {colored ? <span style={{ color: colorForRelative(n, basis) }}>{String(val)}</span> : <span>{String(val)}</span>}
                                <div style={{ fontSize:12, color:'var(--muted)' }}>({Number(pts).toFixed(1)})</div>
                              </div>
                            </td>
                          )
                        })}
                        <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:700 }}>
                          {completedCount ? totalsA.toFixed(1) : 0}
                        </td>
                      </tr>

                      {tB?.playerIds?.map((pid, idx) => (
                        <tr key={pid || idx}>
                          <td style={{ border:'1px solid var(--border)', padding:6 }}>
                            {(players.find(p => p.id === pid)?.name) || (idx === 0 ? 'B Player 1' : 'B Player 2')}
                          </td>
                          {Array.from({ length: 18 }).map((_, h) => {
                            const v = (scoresByCourse[courseKey] || {})[pid]?.[h] ?? ''
                            const color = colorForRelative(v, parArr[h])
                            return (
                              <td key={h} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[h]) }}>
                                <input className="score" inputMode='numeric' pattern='[0-9]*'
                                  value={v} disabled={!canEdit}
                                  onChange={(e)=>setScore(pid, h, e.target.value.replace(/[^0-9]/g,''))}
                                  style={{ color }} />
                              </td>
                            )
                          })}
                          <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                            {(scoresByCourse[courseKey]?.[pid] || empty18()).reduce((s,v)=>s+(Number(v)||0),0)}
                          </td>
                        </tr>
                      ))}

                      <tr>
                        <td style={{ border:'1px solid var(--border)', padding:6, fontWeight:600 }}>{tB?.name || 'Team B'}</td>
                        {Array.from({ length: 18 }).map((_, i) => {
                          const val = teamRowB[i]
                          const pts = perHole[i].complete ? perHole[i].bPts : 0
                          const n = Number(val)
                          const basis = (m.mode === "aggregate") ? parArr[i] * 2 : parArr[i]
                          const colored = Number.isFinite(n) && (m.mode === "bestball" || m.mode === "skins" || m.mode === "aggregate")
                          return (
                            <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[i]), textAlign:'center' }}>
                              <div style={{ lineHeight:1.1 }}>
                                {colored ? <span style={{ color: colorForRelative(n, basis) }}>{String(val)}</span> : <span>{String(val)}</span>}
                                <div style={{ fontSize:12, color:'var(--muted)' }}>({Number(pts).toFixed(1)})</div>
                              </div>
                            </td>
                          )
                        })}
                        <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:700 }}>
                          {completedCount ? totalsB.toFixed(1) : 0}
                        </td>
                      </tr>

                      <tr>
                        <td style={{ border:'1px solid var(--border)', padding:6, color:'var(--muted)' }}>Result</td>
                        {perHole.map((r, i) => (
                          <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArr[i]), textAlign:'center', fontSize:12, color:'var(--muted)' }}>
                            {r.complete ? r.info : '—'}
                          </td>
                        ))}
                        <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                          {completedCount === 0
                            ? 'No scores yet'
                            : (totalsA > totalsB
                                ? `${tA?.name || 'A'} up ${(totalsA - totalsB).toFixed(1)}`
                                : totalsB > totalsA
                                  ? `${tB?.name || 'B'} up ${(totalsB - totalsA).toFixed(1)}`
                                  : 'All square')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })}

          {/* Records (archived only) */}
          <section className="card" style={{ marginTop: 12 }}>
            <h3>Overall Records (archived matches)</h3>
            <div className="row" style={{ gap: 16, flexWrap:'wrap' }}>
              {teams.map(t => {
                let w=0,l=0,tt=0
                for (const h of history) {
                  const parArray = (COURSES.find(c=>c.key===h.courseKey)?.par)||COURSES[0].par
                  let per = Array.from({length:18},(_,i)=>computeHoleHist(h,i))
                  if (h.mode==='skins') per = applySkinsCarryHist(per)
                  if (!per.every(r=>r.complete)) continue
                  const totals = per.reduce((acc,r)=>({a:acc.a+(r.aPts||0), b:acc.b+(r.bPts||0)}),{a:0,b:0})
                  const aIs = h.teamA.id===t.id, bIs = h.teamB.id===t.id
                  if (aIs || bIs) {
                    if (totals.a>totals.b) { if (aIs) w++; if (bIs) l++ }
                    else if (totals.b>totals.a) { if (bIs) w++; if (aIs) l++ }
                    else { tt++ }
                  }
                }
                return (
                  <div key={t.id} className="pill">{t.name}: {w}-{l}-{tt}</div>
                )
              })}
            </div>
          </section>
        </>
      )}

      {view === 'history' && (
        <section style={{ marginTop: 12, display: 'grid', gap: 12 }}>
          {history.length === 0 && <div className="card">No archived scorecards yet.</div>}
          {history.slice().reverse().map(h => {
            const parArray = (COURSES.find(c => c.key === h.courseKey)?.par) || COURSES[0].par
            let perHole = Array.from({ length: 18 }, (_, i) => computeHoleHist(h, i))
            if (h.mode === 'skins') perHole = applySkinsCarryHist(perHole)
            const totalsA = perHole.reduce((s,r)=>s+(r.aPts||0),0)
            const totalsB = perHole.reduce((s,r)=>s+(r.bPts||0),0)
            return (
              <HistoryCard
                key={h.id}
                h={h}
                parArray={parArray}
                perHole={perHole}
                totalsA={totalsA}
                totalsB={totalsB}
                onDelete={() => deleteHistory(h.id)}
                onRename={(label)=>renameHistory(h.id, label)}
                onRestore={() => restoreHistory(h.id)}
                onExportCSV={() => exportHistoryCSV(h)}
                onExportJSON={() => exportHistoryJSON(h)}
                onPrint={() => printHistory(h)}
              />
            )
          })}
        </section>
      )}
    </div>
  )
}

/** ------------ History Card Component ------------ */
function HistoryCard({ h, parArray, perHole, totalsA, totalsB, onDelete, onRename, onRestore, onExportCSV, onExportJSON, onPrint }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(h.label || '')
  return (
    <div className="card">
      <div className="row" style={{ justifyContent:'space-between' }}>
        <div className="row">
          <input value={label} onChange={(e)=>setLabel(e.target.value)} onBlur={()=>label!==h.label && onRename(label)} style={{ minWidth: 260 }} />
          <span className="pill">{nowStr(h.savedAt)}</span>
        </div>
        <div className="row">
          <button className="btn" onClick={onRestore}>Restore to Live</button>
          <button className="btn" onClick={onExportCSV}>Export CSV</button>
          <button className="btn" onClick={onExportJSON}>Export JSON</button>
          <button className="btn" onClick={onPrint}>Print / PDF</button>
          <button className="btn" onClick={()=>setOpen(o=>!o)}>{open?'Hide':'View'}</button>
          <button className="btn" onClick={onDelete}>Delete</button>
        </div>
      </div>

      {open && (
        <div className="tableWrap" style={{ marginTop:8 }}>
          <table style={{ borderCollapse:'collapse', minWidth:940, width:'100%' }}>
            <thead>
              <tr>
                <th style={{ border:'1px solid var(--border)', padding:6, textAlign:'left' }}>Row</th>
                {Array.from({ length: 18 }).map((_, i) => (
                  <th key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArray[i]) }}>H{i + 1}</th>
                ))}
                <th style={{ border:'1px solid var(--border)', padding:6 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border:'1px solid var(--border)', padding:6, fontWeight:600 }}>Par</td>
                {parArray.map((p, i) => (
                  <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArray[i]), textAlign:'center', color:'var(--muted)' }}>{p}</td>
                ))}
                <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                  {parArray.reduce((a,b)=>a+b,0)}
                </td>
              </tr>

              {/* Team A players */}
              {h.teamA.playerIds.map((pid, idx) => (
                <tr key={pid || idx}>
                  <td style={{ border:'1px solid var(--border)', padding:6 }}>
                    {h.teamA.playerNames?.[idx] || (idx===0?'A Player 1':'A Player 2')}
                  </td>
                  {Array.from({ length: 18 }).map((_, i) => {
                    const v = h.scores?.[pid]?.[i] ?? ''
                    const color = colorForRelative(v, parArray[i])
                    return (
                      <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArray[i]), textAlign:'center', color }}>
                        {v || '—'}
                      </td>
                    )
                  })}
                  <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                    {(h.scores?.[pid] || []).reduce((s,v)=>s+(Number(v)||0),0)}
                  </td>
                </tr>
              ))}

              {/* Team A combined */}
              <tr>
                <td style={{ border:'1px solid var(--border)', padding:6, fontWeight:600 }}>{h.teamA.name}</td>
                {Array.from({ length: 18 }).map((_, i) => (
                  <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArray[i]), textAlign:'center' }}>
                    <div style={{ fontSize:12, color:'var(--muted)' }}>({Number(perHole[i].aPts || 0).toFixed(1)})</div>
                  </td>
                ))}
                <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:700 }}>
                  {totalsA.toFixed(1)}
                </td>
              </tr>

              {/* Team B players */}
              {h.teamB.playerIds.map((pid, idx) => (
                <tr key={pid || idx}>
                  <td style={{ border:'1px solid var(--border)', padding:6 }}>
                    {h.teamB.playerNames?.[idx] || (idx===0?'B Player 1':'B Player 2')}
                  </td>
                  {Array.from({ length: 18 }).map((_, i) => {
                    const v = h.scores?.[pid]?.[i] ?? ''
                    const color = colorForRelative(v, parArray[i])
                    return (
                      <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArray[i]), textAlign:'center', color }}>
                        {v || '—'}
                      </td>
                    )
                  })}
                  <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:600 }}>
                    {(h.scores?.[pid] || []).reduce((s,v)=>s+(Number(v)||0),0)}
                  </td>
                </tr>
              ))}

              {/* Team B combined */}
              <tr>
                <td style={{ border:'1px solid var(--border)', padding:6, fontWeight:600 }}>{h.teamB.name}</td>
                {Array.from({ length: 18 }).map((_, i) => (
                  <td key={i} style={{ border:'1px solid var(--border)', padding:6, backgroundColor: holeBgForPar(parArray[i]), textAlign:'center' }}>
                    <div style={{ fontSize:12, color:'var(--muted)' }}>({Number(perHole[i].bPts || 0).toFixed(1)})</div>
                  </td>
                ))}
                <td style={{ border:'1px solid var(--border)', padding:6, textAlign:'center', fontWeight:700 }}>
                  {totalsB.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
