import React, { useEffect, useState } from 'react'

export default function BOMPanel({ dia: propDia, setDia: propSetDia, length: propLength, setLength: propSetLength, count: propCount, setCount: propSetCount, bomLines, setBomLines }){
  const [rebarLib, setRebarLib] = useState({})
  const [localDia, setLocalDia] = useState('16mm')
  const [localLength, setLocalLength] = useState(3.0)
  const [localCount, setLocalCount] = useState(4)

  useEffect(()=>{
    async function fetchLib(){
      try{
        const res = await fetch('http://localhost:4000/api/rebar')
        if (res.ok) setRebarLib(await res.json())
      }catch(e){/* ignore */}
    }
    fetchLib()
  }, [])

  function unitWeight(diaKey){
    if (rebarLib && rebarLib[diaKey]) return rebarLib[diaKey]
    const n = Number(diaKey.replace('mm',''))
    if (isNaN(n)) return 0
    return +( (n*n)/162 ).toFixed(3)
  }

  const diaUsed = propDia ?? localDia
  const lengthUsed = propLength ?? localLength
  const countUsed = propCount ?? localCount

  const u = unitWeight(diaUsed)
  const totalKg = +(u * lengthUsed * countUsed).toFixed(3)
  const totalMeters = +(lengthUsed * countUsed).toFixed(3)

  const available = Object.keys(rebarLib).length ? Object.keys(rebarLib) : ['10mm','12mm','16mm','20mm','25mm','32mm']

  return (
    <div style={{padding:12, width:320, boxSizing:'border-box', background:'#ffffff', borderLeft:'1px solid #e6eef5'}}>
      <h3 style={{marginTop:0}}>BOM — Quick Rebar Calc</h3>

      {bomLines && bomLines.length > 0 && (
        <div style={{marginBottom:12}}>
          <strong>Project BOM</strong>
          <div style={{marginTop:8}}>
            {bomLines.map(line => (
              <div key={line.id} style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 0', borderBottom:'1px solid #f0f4f8'}}>
                <div style={{flex:1}}>{line.type} — {line.dia} &times; {line.count} @ {line.length} m</div>
                <div style={{width:80, textAlign:'right'}}>{line.totalKg} kg</div>
                <div style={{width:60, textAlign:'right'}}>
                  <button onClick={()=> setBomLines ? setBomLines(b => b.filter(l => l.id !== line.id)) : null} style={{marginLeft:8}}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Bar Diameter</label>
        <select value={diaUsed} onChange={e=> (propSetDia ? propSetDia(e.target.value) : setLocalDia(e.target.value)) }>
          {available.map(d=> (
            <option key={d} value={d}>{d}{rebarLib[d] ? ` — ${rebarLib[d]} kg/m` : ''}</option>
          ))}
        </select>
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Length per bar (m)</label>
        <input type="number" step="0.01" value={lengthUsed} onChange={e=> (propSetLength ? propSetLength(Number(e.target.value)) : setLocalLength(Number(e.target.value))) } style={{width:'100%'}} />
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Count</label>
        <input type="number" value={countUsed} onChange={e=> (propSetCount ? propSetCount(Number(e.target.value)) : setLocalCount(Number(e.target.value))) } style={{width:'100%'}} />
      </div>

      <div style={{marginTop:12}}>
        <div><strong>Unit weight:</strong> {u} kg/m</div>
        <div><strong>Total length:</strong> {totalMeters} m</div>
        <div><strong>Total weight:</strong> {totalKg} kg</div>
      </div>
    </div>
  )
}
