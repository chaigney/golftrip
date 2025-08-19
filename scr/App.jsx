import React, { useState } from 'react'
import { db } from './firebase'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'

const COURSES = [
  { key: 'hiawatha', name: 'The Links at Hiawatha Landing' },
  { key: 'enjoie',   name: 'En-Joie Golf Club' },
  { key: 'conklin',  name: 'Conklin Players Club' },
]

function uid(){ return Math.random().toString(36).slice(2, 9) }
function getTripIdFromUrl(){ try{const u=new URL(window.location.href); return u.searchParams.get('trip')||'' }catch{return ''} }
function setTripIdInUrl(id){ const u=new URL(window.location.href); u.searchParams.set('trip', id); window.history.replaceState({},'',u.toString()) }

export default function App(){
  const [tripId, setTripId] = useState(getTripIdFromUrl())
  const [courseKey, setCourseKey] = useState(COURSES[0].key)

  async function createTrip(){
    const id = uid()+uid()
    await setDoc(doc(db,'trips',id), {
      createdAt: serverTimestamp(),
      players:[], teams:[], matches:[],
      courseKey: 'hiawatha',
      scoresByCourse:{ hiawatha:{}, enjoie:{}, conklin:{} }
    })
    setTripId(id); setTripIdInUrl(id)
  }

  if(!tripId){
    return (<div style={{padding:24,fontFamily:'system-ui,sans-serif'}}>
      <h1>Golf Trip App</h1>
      <p>Create a shared trip so everyone can edit scores from their phones.</p>
      <button onClick={createTrip}>Create Trip</button>
      <p style={{marginTop:12,fontSize:12,opacity:.75}}>After creating, share the URL (it will contain <code>?trip=&lt;id&gt;</code>).</p>
    </div>)
  }

  return (<div style={{padding:24,fontFamily:'system-ui,sans-serif'}}>
    <h2>Trip: <code>{tripId}</code></h2>
    <p>Firebase config works. Replace <code>src/App.jsx</code> with the full scoring UI we built to get the complete app.</p>
    <div style={{marginTop:12}}>
      <label>Course: </label>
      <select value={courseKey} onChange={e=>setCourseKey(e.target.value)}>
        {COURSES.map(c=><option key={c.key} value={c.key}>{c.name}</option>)}
      </select>
    </div>
  </div>)
}
