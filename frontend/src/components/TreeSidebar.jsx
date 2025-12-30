import React, { useState } from 'react'

// TreeSidebar can accept a getNodes function and onSelect callback

function TreeNode({node, depth=0, onSelect, onRequestDelete, onRequestDeleteMember}){
  const [open, setOpen] = useState(true)
  return (
    <div style={{paddingLeft: depth*12, marginBottom:6}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}} onClick={()=>setOpen(!open)}>
        <div style={{display:'flex', alignItems:'center', cursor:'pointer'}}>
          <div style={{width:14, textAlign:'center', marginRight:6}}>{node.children ? (open? '▾':'▸') : ''}</div>
          <div style={{fontSize:13, color:'#16213e'}} onClick={(e)=>{ e.stopPropagation(); node.id && onSelect && onSelect(node.id) }}>{node.label}</div>
        </div>
        {node.id ? (
          <button onClick={(e)=>{ e.stopPropagation(); if (node.type === 'member') { onRequestDeleteMember ? onRequestDeleteMember(node.id) : (onRequestDelete && onRequestDelete({type:'member', id: node.id})) } else { onRequestDelete && onRequestDelete({type:'node', id: node.id}) } }} style={{marginLeft:8}}>Delete</button>
        ) : null}
      </div>
        {open && node.children && (
        <div style={{marginTop:6}}>
          {node.children.map((c,idx)=> (
            <TreeNode key={idx} node={c} depth={depth+1} onSelect={onSelect} onRequestDelete={onRequestDelete} onRequestDeleteMember={onRequestDeleteMember} />
          ))}
        </div>
      )}
      
    </div>
  )
}

export default function TreeSidebar({ open=true, onToggle, getNodes, onSelect, nodes, members, onRequestDelete, onRequestDeleteMember, selectedDia, setSelectedDia, rebarLib }){
  const rawNodes = nodes && Array.isArray(nodes) ? nodes : ((getNodes && getNodes()) || [])
  const formattedNodes = rawNodes.length ? rawNodes.map((n, idx)=> ({ label: `#${idx}: (${Number(n.position.x).toFixed(2)}, ${Number(n.position.y).toFixed(2)}, ${Number(n.position.z).toFixed(2)})`, id: n.id, type: 'node' })) : [ { label: 'No nodes' } ]

  const rawMembers = members && Array.isArray(members) ? members : []
  const nodesById = Object.fromEntries(rawNodes.map(n=>[n.id, n.position]))
  const formattedMembers = rawMembers.length ? rawMembers.map((m, idx)=>{
    const a = nodesById[m.a]
    const b = nodesById[m.b]
    const len = a && b ? Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) : null
    // prefer provided unit weight -> fall back to rebarLib or formula
    const unitWeight = m.unitWeight || (rebarLib && rebarLib[selectedDia]) || (()=>{ const n = Number(String(selectedDia).replace('mm','')); return isNaN(n) ? 0 : +((n*n)/162).toFixed(3) })()
    const weight = unitWeight && len ? +(unitWeight * len).toFixed(3) : null
    const label = `#${idx}: ${m.a.slice(0,6)} ↔ ${m.b.slice(0,6)}${len ? ` — ${len.toFixed(3)} m` : ''}${weight ? ` • ${weight} kg` : ''}`
    return { label, id: m.id, type: 'member', length: len, a: m.a, b: m.b }
  }) : [ { label: 'No members' } ]

  const tree = {
    label: 'Project',
    children: [
      { label: 'Nodes', children: formattedNodes },
      { label: 'Members', children: formattedMembers },
      { label: 'Sections', children: [ {label:'I-Sections'}, {label:'Rectangles'} ] },
      { label: 'BOM' }
    ]
  }

  return (
    <div style={{width: open? 260: 36, transition:'width 220ms ease', background:'#ffffff', borderRight:'1px solid #e6eef8', display:'flex', flexDirection:'column'}}>
      <div style={{padding:8, borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{fontWeight:700, color:'#09203f', fontSize:14}}>{open? 'Project Tree' : 'PT'}</div>
        <button onClick={onToggle} style={{border:'none', background:'transparent', cursor:'pointer', fontSize:14}}>{open? '⟨' : '⟩'}</button>
      </div>
      {open && (
        <div style={{padding:10, borderBottom:'1px solid #f1f5f9'}}>
          <label style={{display:'block', fontSize:12, marginBottom:6}}>Project Bar Diameter</label>
          <select value={selectedDia} onChange={e=> setSelectedDia && setSelectedDia(e.target.value)} style={{width:'100%'}}>
            {Object.keys(rebarLib).length ? Object.keys(rebarLib).map(k=> <option key={k} value={k}>{k}{rebarLib[k] ? ` — ${rebarLib[k]} kg/m` : ''}</option>) : ['10mm','12mm','16mm','20mm','25mm','32mm'].map(d=> <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      )}
      <div style={{flex:1, overflow:'auto', padding:10}}>
        {open && <TreeNode node={tree} onSelect={onSelect} onRequestDelete={onRequestDelete} onRequestDeleteMember={onRequestDeleteMember} />}
      </div>
      <div style={{padding:8, borderTop:'1px solid #f1f5f9', fontSize:12, color:'#456'}}>
        {open? 'Tip: double-click scene to place node' : ''}
      </div>
    </div>
  )
}
