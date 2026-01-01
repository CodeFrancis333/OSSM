import React, { useState } from 'react'

// TreeSidebar can accept a getNodes function and onSelect callback

function TreeNode({node, depth=0, onSelect, onRequestDelete, onRequestDeleteMember, onUpdateMember}){
  const [open, setOpen] = useState(true)
  return (
    <div style={{paddingLeft: depth*12, marginBottom:6}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}} onClick={()=>setOpen(!open)}>
        <div style={{display:'flex', alignItems:'center', cursor:'pointer'}}>
          <div style={{width:14, textAlign:'center', marginRight:6}}>{node.children ? (open? '▾':'▸') : ''}</div>
          <div
            style={{fontSize:13, color:'#16213e'}}
            onClick={(e)=>{
              e.stopPropagation()
              node.id && onSelect && onSelect({ id: node.id, type: node.type })
            }}
          >
            {node.label}
          </div>
        </div>
        {node.id ? (
          <div style={{display:'flex', alignItems:'center', gap:6}}>
            {node.type === 'member' && onUpdateMember && (
              <button
                onClick={(e)=>{
                  e.stopPropagation()
                  const nextPreview = node.preview === 'line' ? 'shape' : 'line'
                  onUpdateMember(node.id, { preview: nextPreview })
                }}
              >
                {node.preview === 'line' ? 'Shape' : 'Line'}
              </button>
            )}
            <button
              onClick={(e)=>{
                e.stopPropagation()
                if (node.type === 'member') {
                  onRequestDeleteMember ? onRequestDeleteMember(node.id) : (onRequestDelete && onRequestDelete({type:'member', id: node.id}))
                } else if (node.type === 'footing') {
                  onRequestDelete && onRequestDelete({type:'footing', id: node.id})
                } else if (node.type === 'floor') {
                  onRequestDelete && onRequestDelete({type:'floor', id: node.id})
                } else {
                  onRequestDelete && onRequestDelete({type:'node', id: node.id})
                }
              }}
              style={{marginLeft:8}}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
        {open && node.children && (
        <div style={{marginTop:6}}>
          {node.children.map((c,idx)=> (
            <TreeNode key={idx} node={c} depth={depth+1} onSelect={onSelect} onRequestDelete={onRequestDelete} onRequestDeleteMember={onRequestDeleteMember} onUpdateMember={onUpdateMember} />
          ))}
        </div>
      )}
      
    </div>
  )
}

export default function TreeSidebar({ open=true, onToggle, getNodes, onSelect, nodes, members, footings, floors, sections, onRequestDelete, onRequestDeleteMember, onUpdateMember, selectedDia, setSelectedDia, rebarLib }){
  const rawNodes = nodes && Array.isArray(nodes) ? nodes : ((getNodes && getNodes()) || [])
  const formattedNodes = rawNodes.length ? rawNodes.map((n, idx)=> ({ label: `#${idx}: (${Number(n.position.x).toFixed(2)}, ${Number(n.position.y).toFixed(2)}, ${Number(n.position.z).toFixed(2)})`, id: n.id, type: 'node' })) : [ { label: 'No nodes' } ]

  const rawMembers = members && Array.isArray(members) ? members : []
  const nodesById = Object.fromEntries(rawNodes.map(n=>[n.id, n.position]))
  const sectionsById = Object.fromEntries((sections || []).map(s => [s.id, s]))
  const formattedMembers = rawMembers.length ? rawMembers.map((m, idx)=>{
    const a = nodesById[m.a]
    const b = nodesById[m.b]
    const len = a && b ? Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) : null
    const sectionName = m.sectionId && sectionsById[m.sectionId] ? sectionsById[m.sectionId].name : null
    // prefer provided unit weight -> fall back to rebarLib or formula
    const unitWeight = m.unitWeight || (rebarLib && rebarLib[selectedDia]) || (()=>{ const n = Number(String(selectedDia).replace('mm','')); return isNaN(n) ? 0 : +((n*n)/162).toFixed(3) })()
    const weight = unitWeight && len ? +(unitWeight * len).toFixed(3) : null
    const label = `#${idx}: ${m.a.slice(0,6)} ↔ ${m.b.slice(0,6)}${m.type ? ` [${m.type}]` : ''}${sectionName ? ` {${sectionName}}` : ''}${len ? ` — ${len.toFixed(3)} m` : ''}${weight ? ` • ${weight} kg` : ''}`
    return { label, id: m.id, type: 'member', length: len, a: m.a, b: m.b, preview: m.preview || 'shape' }
  }) : [ { label: 'No members' } ]

  const rawFootings = footings && Array.isArray(footings) ? footings : []
  const formattedFootings = rawFootings.length ? rawFootings.map((f, idx)=> {
    const sectionName = f.sectionId && sectionsById[f.sectionId] ? sectionsById[f.sectionId].name : null
    const size = f.size || {}
    const label = `#${idx}: Node ${f.nodeId?.slice(0,6) || 'unknown'}${sectionName ? ` {${sectionName}}` : ''} (${size.x||0}x${size.y||0}x${size.z||0})`
    return { label, id: f.id, type: 'footing' }
  }) : [ { label: 'No footings' } ]

  const rawFloors = floors && Array.isArray(floors) ? floors : []
  const formattedFloors = rawFloors.length
    ? rawFloors.map((f, idx)=> ({
      label: `#${idx}: ${f.name || 'Floor'} @ ${Number(f.elevation || 0).toFixed(2)} m`,
      id: f.id,
      type: 'floor',
    }))
    : [ { label: 'No floors' } ]

  const sectionGroups = (sections || []).reduce((acc, s) => {
    const key = s.category || 'other'
    if (!acc[key]) acc[key] = []
    acc[key].push({ label: s.name || 'Section' })
    return acc
  }, {})
  const formattedSections = Object.keys(sectionGroups).length
    ? Object.keys(sectionGroups).map((k) => ({ label: k, children: sectionGroups[k] }))
    : [ { label: 'No sections' } ]

  const tree = {
    label: 'Project',
    children: [
      { label: 'Floors', children: formattedFloors },
      { label: 'Nodes', children: formattedNodes },
      { label: 'Members', children: formattedMembers },
      { label: 'Footings', children: formattedFootings },
      { label: 'Sections', children: formattedSections },
      { label: 'BOM' }
    ]
  }

  return (
    <div style={{width: open? 260: 36, transition:'width 220ms ease', background:'#ffffff', borderRight:'1px solid #e6eef8', display:'flex', flexDirection:'column'}}>
      <div style={{padding:8, borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{fontWeight:700, color:'#09203f', fontSize:14}}>{open? 'Project Tree' : 'PT'}</div>
        <button onClick={onToggle} style={{border:'none', background:'transparent', cursor:'pointer', fontSize:14}}>{open? '⟨' : '⟩'}</button>
      </div>
      <div style={{flex:1, overflow:'auto', padding:10}}>
        {open && <TreeNode node={tree} onSelect={onSelect} onRequestDelete={onRequestDelete} onRequestDeleteMember={onRequestDeleteMember} onUpdateMember={onUpdateMember} />}
      </div>
      <div style={{padding:8, borderTop:'1px solid #f1f5f9', fontSize:12, color:'#456'}}>
        {open? 'Tip: double-click scene to place node' : ''}
      </div>
    </div>
  )
}
