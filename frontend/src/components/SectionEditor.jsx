import React, { useRef, useEffect, useState } from 'react'
import { validateSpacing, parseDiaLabel } from '../utils/nscp'

export default function SectionEditor({ selectedDia: propDia, setSelectedDia: propSetDia, length: propLength, setLength: propSetLength, count: propCount, setCount: propSetCount, addBomLine, onSectionChange }){
  const canvasRef = useRef(null)
  const [metric, setMetric] = useState(true)
  const [beta, setBeta] = useState(0)
  const [rebarLib, setRebarLib] = useState({})
  const [detailing, setDetailing] = useState({ S_min_mm: 25 })
  const [localDia, setLocalDia] = useState('16mm')
  const [spacing, setSpacing] = useState(50) // mm
  const [memberWidthMm, setMemberWidthMm] = useState(300)
  const [layersCount, setLayersCount] = useState(2)
  const [spacingTop, setSpacingTop] = useState(50)
  const [spacingMiddle, setSpacingMiddle] = useState(50)
  const [spacingBottom, setSpacingBottom] = useState(50)

  useEffect(()=>{
    const c = canvasRef.current
    const ctx = c.getContext('2d')
    function draw(){
      ctx.clearRect(0,0,c.width,c.height)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0,0,c.width,c.height)
      ctx.strokeStyle = '#333'
      ctx.strokeRect(10,10,c.width-20,c.height-20)
      ctx.fillStyle = '#000'
      ctx.fillText('Section Editor (2D) - placeholder', 20, 30)
      ctx.fillText(`Beta: ${beta} deg`, 20, 50)
    }
    draw()
  }, [beta])
  
    useEffect(()=>{
      // fetch rebar library and detailing rules from backend
      async function fetchData(){
        try {
          const [rRes, dRes] = await Promise.all([
            fetch('http://localhost:4000/api/rebar'),
            fetch('http://localhost:4000/api/detailing')
          ])
          if (rRes.ok) setRebarLib(await rRes.json())
          if (dRes.ok) setDetailing(await dRes.json())
        } catch (e) {
          // fallback: local defaults already provided in state
          console.warn('Could not fetch backend data', e)
        }
      }
      fetchData()
    }, [])
  
    function parseDia(mmKey){
      return parseDiaLabel(mmKey)
    }

    const diaUsed = propDia ?? localDia
    const errors = validateSpacing({ diaMm: parseDia(diaUsed), spacingMm: spacing, detailing })

  useEffect(() => {
    if (typeof onSectionChange !== 'function') return
    const payload = {
      diaLabel: diaUsed,
      spacing,
      memberWidthMm,
      layersCount,
      spacingTop,
      spacingMiddle,
      spacingBottom,
      errors,
      detailing,
    }
    onSectionChange(payload)
  }, [diaUsed, spacing, memberWidthMm, layersCount, spacingTop, spacingMiddle, spacingBottom, errors, detailing, onSectionChange])

  const diaValue = propDia ?? localDia
  const setDiaValue = propSetDia ?? setLocalDia

  return (
    <div style={{padding:12, width:340, boxSizing:'border-box', background:'#f8fafc', borderRight:'1px solid #e6eef5'}}>
      <h3 style={{marginTop:0}}>Section Editor</h3>
      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Units</label>
        <button onClick={()=>setMetric(true)} style={{marginRight:6}} aria-pressed={metric}>Metric</button>
        <button onClick={()=>setMetric(false)} aria-pressed={!metric}>Imperial</button>
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Beta Angle (deg)</label>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          <input type="range" min="-180" max="180" value={beta} onChange={e=>setBeta(Number(e.target.value))} />
          <input
            type="number"
            min="-180"
            max="180"
            step="1"
            value={beta}
            onChange={e=>setBeta(Number(e.target.value) || 0)}
            style={{width:70}}
          />
        </div>
        <div>{beta} deg</div>
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Rebar Diameter</label>
        <select value={diaValue} onChange={e=>setDiaValue(e.target.value)}>
          {Object.keys(rebarLib).length === 0 ? (
            ['10mm','12mm','16mm','20mm','25mm','32mm'].map(d=> <option key={d} value={d}>{d}</option>)
          ) : (
            Object.keys(rebarLib).map(d=> <option key={d} value={d}>{d} — {rebarLib[d]} kg/m</option>)
          )}
        </select>
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Member Width (mm)</label>
        <input type="number" value={memberWidthMm} onChange={e=>setMemberWidthMm(Number(e.target.value))} style={{width:'100%'}} />
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Length per bar (m)</label>
        <input type="number" step="0.01" value={propLength ?? ''} onChange={e=> propSetLength ? propSetLength(Number(e.target.value)) : null} style={{width:'100%'}} />
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Count</label>
        <input type="number" value={propCount ?? ''} onChange={e=> propSetCount ? propSetCount(Number(e.target.value)) : null} style={{width:'100%'}} />
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Global Spacing (mm)</label>
        <input type="number" value={spacing} onChange={e=>setSpacing(Number(e.target.value))} style={{width:'100%'}} />
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Layers Count</label>
        <select value={layersCount} onChange={e=>setLayersCount(Number(e.target.value))}>
          <option value={1}>1 (middle)</option>
          <option value={2}>2 (top & bottom)</option>
          <option value={3}>3 (top, middle & bottom)</option>
        </select>
      </div>

      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Spacing Top (mm)</label>
        <input type="number" value={spacingTop} onChange={e=>setSpacingTop(Number(e.target.value))} style={{width:'100%'}} />
      </div>
      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Spacing Middle (mm)</label>
        <input type="number" value={spacingMiddle} onChange={e=>setSpacingMiddle(Number(e.target.value))} style={{width:'100%'}} />
      </div>
      <div style={{marginBottom:8}}>
        <label style={{display:'block', marginBottom:4}}>Spacing Bottom (mm)</label>
        <input type="number" value={spacingBottom} onChange={e=>setSpacingBottom(Number(e.target.value))} style={{width:'100%'}} />
      </div>

      <div style={{marginBottom:8}}>
        <strong>NSCP Checks</strong>
        <div style={{marginTop:6}}>
          {errors.length === 0 ? (
            <div style={{color:'green'}}>All checks passed (S_min = {detailing.S_min_mm} mm)</div>
          ) : (
            errors.map((er,i)=> <div key={i} style={{color:'red'}}>{er}</div>)
          )}
        </div>
      </div>

      <canvas ref={canvasRef} width={300} height={200} style={{border:'1px solid #d1e2f0', background:'#fff'}} />

      <div style={{marginTop:12}}>
        <button style={{marginRight:8}} onClick={()=>{
          // Auto Rebar: compute number of bars across member width per configured layers and add BOM lines
          const diaUsed = propDia ?? localDia
          const lengthUsed = propLength ?? 0
          const diaMm = parseDia(diaUsed)
          const clearCover = detailing.clear_cover_member_mm || 40
          const start = clearCover + diaMm/2
          const end = memberWidthMm - clearCover - diaMm/2
          if (end < start) return

          const layersToGenerate = []
          if (layersCount === 1) layersToGenerate.push({ name: 'middle', spacing: spacingMiddle || spacing })
          if (layersCount === 2) {
            layersToGenerate.push({ name: 'top', spacing: spacingTop || spacing })
            layersToGenerate.push({ name: 'bottom', spacing: spacingBottom || spacing })
          }
          if (layersCount === 3) {
            layersToGenerate.push({ name: 'top', spacing: spacingTop || spacing })
            layersToGenerate.push({ name: 'middle', spacing: spacingMiddle || spacing })
            layersToGenerate.push({ name: 'bottom', spacing: spacingBottom || spacing })
          }

          const unitWeight = rebarLib[diaUsed] ?? +((diaMm*diaMm)/162).toFixed(3)

          for (const layer of layersToGenerate){
            const spacingUsed = layer.spacing || spacing
            const barsPerLayer = Math.max(0, Math.floor((end - start) / spacingUsed) + 1)
            if (barsPerLayer <= 0) continue
            const countUsed = barsPerLayer
            const totalKg = +(unitWeight * lengthUsed * countUsed).toFixed(3)
            if (typeof addBomLine === 'function'){
              addBomLine({ type: `rebar_${layer.name}`, dia: diaUsed, length: lengthUsed, count: countUsed, unitWeight, totalKg })
            }
          }
        }}>Auto Rebar</button>
        <button>Manual Rebar</button>
        <button style={{marginLeft:8}} onClick={()=>{
          const diaUsed = propDia ?? localDia
          const lengthUsed = propLength ?? 0
          const countUsed = propCount ?? 0
          const unitWeight = rebarLib[diaUsed] ?? +((parseDia(diaUsed)*parseDia(diaUsed))/162).toFixed(3)
          const totalKg = +(unitWeight * lengthUsed * countUsed).toFixed(3)
          if (typeof addBomLine === 'function'){
            addBomLine({ type: 'rebar', dia: diaUsed, length: lengthUsed, count: countUsed, unitWeight, totalKg })
          }
        }}>Add to BOM</button>
      </div>
    </div>
  )
}
