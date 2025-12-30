import React, { useState, useRef, useEffect } from 'react'
import * as THREE from 'three'
import ThreeScene from './components/ThreeScene'
import SectionEditor from './components/SectionEditor'
import BOMPanel from './components/BOMPanel'
import TreeSidebar from './components/TreeSidebar'
import ConfirmModal from './components/ConfirmModal'

export default function App(){
  const [dia, setDia] = useState('16mm')
  const [length, setLength] = useState(3.0)
  const [count, setCount] = useState(4)
  const [bomLines, setBomLines] = useState([])

  function addBomLine(line){
    const withId = { id: Date.now() + Math.random(), ...line }
    setBomLines(s => [withId, ...s])
  }

  const threeRef = useRef(null)
  const [sceneNodes, setSceneNodes] = useState([])
  const [sceneMembers, setSceneMembers] = useState([])
  const [rebarLib, setRebarLib] = useState({})
  const [pendingDelete, setPendingDelete] = useState(null) // {type,id,label}
  const [undoStack, setUndoStack] = useState([]) // array of { id, item, timer }

  function handleSceneChange(payload){
    // payload: { nodes: [...], members: [...] }
    if (!payload) return
    setSceneNodes(payload.nodes || [])
    setSceneMembers(payload.members || [])
  }

  useEffect(()=>{
    async function fetchLib(){
      try{
        const res = await fetch('http://localhost:4000/api/rebar')
        if (res.ok) setRebarLib(await res.json())
      }catch(e){ /* ignore */ }
    }
    fetchLib()
  }, [])

  function onRequestDelete(req){
    // req: { type: 'node'|'member', id }
    if (!req) return
    const label = req.type === 'node' ? `Node ${req.id.slice(0,6)}` : `Member ${req.id.slice(0,6)}`
    setPendingDelete({ ...req, label })
  }

  function confirmDelete(){
    if (!pendingDelete) return
    const { type, id } = pendingDelete
    // prepare undo payload from current scene state
    if (type === 'node'){
      const node = sceneNodes.find(n=>n.id===id)
      const attached = sceneMembers.filter(m=>m.a===id || m.b===id)
      // delete
      if (threeRef.current && typeof threeRef.current.deleteNode === 'function'){
        threeRef.current.deleteNode(id)
      }
      // push undo
      const undo = { type:'node', node, attached }
      scheduleUndo(undo)
    } else if (type === 'member'){
      const member = sceneMembers.find(m=>m.id===id)
      if (threeRef.current && typeof threeRef.current.deleteMember === 'function'){
        threeRef.current.deleteMember(id)
      }
      const undo = { type:'member', member }
      scheduleUndo(undo)
    }
    setPendingDelete(null)
  }

  function scheduleUndo(item){
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6)
    // create timer to remove this undo entry
    const timer = setTimeout(()=>{
      setUndoStack(s => s.filter(x => x.id !== id))
    }, 8000)
    setUndoStack(s => [{ id, item, timer }, ...s])
  }

  async function handleUndo(){
    // pop the most recent undo entry
    setUndoStack(stack => {
      if (!stack || stack.length === 0) return stack
      const [top, ...rest] = stack
      const { item, timer } = top
      if (timer) clearTimeout(timer)
      // restore
      if (item.type === 'node'){
        const pos = item.node.position
        const newId = threeRef.current && typeof threeRef.current.addNode === 'function' ? threeRef.current.addNode(new THREE.Vector3(pos.x, pos.y, pos.z)) : null
        const oldToNew = {}
        if (newId) oldToNew[item.node.id] = newId
        for (const m of (item.attached||[])){
          const aId = oldToNew[m.a] || m.a
          const bId = oldToNew[m.b] || m.b
          if (threeRef.current && typeof threeRef.current.addMember === 'function'){
            threeRef.current.addMember(aId, bId)
          }
        }
      } else if (item.type === 'member'){
        const m = item.member
        if (threeRef.current && typeof threeRef.current.addMember === 'function'){
          threeRef.current.addMember(m.a, m.b)
        }
      }
      return rest
    })
  }

  return (
    <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
      <header style={{padding: 12, background: '#0f172a', color: '#fff'}}>
        OSSM — Open-Source Structural Modeler
      </header>
      <div style={{flex:1, display:'flex', minHeight:0}}>
        <TreeSidebar
          open={true}
          onToggle={() => { /* toggled by internal button for now */ }}
          nodes={sceneNodes}
          members={sceneMembers}
          onSelect={(id)=>{ if (threeRef.current) threeRef.current.selectNode(id) }}
          onRequestDelete={(req)=> onRequestDelete(req)}
          onRequestDeleteMember={(id)=> onRequestDelete({ type: 'member', id })}
          selectedDia={dia}
          setSelectedDia={setDia}
          rebarLib={rebarLib}
        />
        <SectionEditor selectedDia={dia} setSelectedDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} addBomLine={addBomLine} />
        <div style={{flex:1}}>
          <ThreeScene ref={threeRef} onSceneChange={handleSceneChange} onRequestDelete={(req)=> onRequestDelete(req)} />
        </div>
        <BOMPanel dia={dia} setDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} bomLines={bomLines} setBomLines={setBomLines} />
      </div>
      {pendingDelete && (
        <ConfirmModal open={!!pendingDelete} title={`Delete ${pendingDelete.label}`} message={`Are you sure you want to delete ${pendingDelete.label}?`} onConfirm={confirmDelete} onCancel={()=>setPendingDelete(null)} />
      )}

      {undoStack && undoStack.length > 0 && (
        <div style={{position:'fixed', left:12, bottom:12}} className="undo-list">
          {undoStack.map((u,idx)=> (
            <div key={u.id} className="undo-item">
              <div style={{flex:1}}>{u.item.type} deleted</div>
              <button onClick={()=>{
                // restore this specific undo (move it to top then call handleUndo)
                setUndoStack(stack => {
                  const pos = stack.findIndex(x=>x.id===u.id)
                  if (pos === -1) return stack
                  const copy = [...stack]
                  const [entry] = copy.splice(pos,1)
                  return [entry, ...copy]
                })
                handleUndo()
              }}>Undo</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
