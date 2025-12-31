import React, { useState, useRef, useEffect } from 'react'
import * as THREE from 'three'
import ThreeScene from './components/ThreeScene'
import SectionEditor from './components/SectionEditor'
import BOMPanel from './components/BOMPanel'
import TreeSidebar from './components/TreeSidebar'
import ConfirmModal from './components/ConfirmModal'
import {
  createEmptyModel,
  loadModel,
  normalizeModel,
  saveModel,
  setSelection,
  translateSelection,
  rotateFooting,
  rotateMember,
  addFloor,
  updateFloor,
  removeFloor,
  addSection,
  updateSection,
  removeSection,
} from './utils/model'

export default function App(){
  const [dia, setDia] = useState('16mm')
  const [length, setLength] = useState(3.0)
  const [count, setCount] = useState(4)
  const [bomLines, setBomLines] = useState([])
  const [footingSize, setFootingSize] = useState({ x: 1.2, y: 0.4, z: 1.2 })
  const [floorName, setFloorName] = useState('')
  const [floorElev, setFloorElev] = useState(0)
  const [sectionForm, setSectionForm] = useState({
    name: '',
    category: 'beam',
    shape: 'rect',
    b: 0.3,
    h: 0.5,
  })
  const [detailingState, setDetailingState] = useState(null)
  const [dupOffset, setDupOffset] = useState({ x: 1, y: 0, z: 0 })

  function addBomLine(line){
    const withId = { id: Date.now() + Math.random(), ...line }
    setBomLines(s => [withId, ...s])
  }

  const threeRef = useRef(null)
  const importRef = useRef(null)
  const pendingMemberMetaRef = useRef({})
  const [model, setModel] = useState(() => loadModel() || createEmptyModel())
  const initialModelRef = useRef(model)
  const [rebarLib, setRebarLib] = useState({})
  const [pendingDelete, setPendingDelete] = useState(null) // {type,id,label}
  const [undoStack, setUndoStack] = useState([]) // array of { id, item, timer }

  function handleSceneChange(payload){
    // payload: { nodes: [...], members: [...] }
    if (!payload) return
    setModel(m => {
      const existingMembers = Object.fromEntries((m.members || []).map((mem) => [mem.id, mem]))
      const existingFootings = Object.fromEntries((m.footings || []).map((f) => [f.id, f]))
      const pending = pendingMemberMetaRef.current || {}
      const members = (payload.members || []).map((mem) => {
        const prev = existingMembers[mem.id]
        const pendingMeta = pending[mem.id]
        if (pendingMeta) delete pending[mem.id]
        const type = pendingMeta?.type || prev?.type || 'beam'
        return {
          ...mem,
          type,
          align: pendingMeta?.align || prev?.align || (type === 'beam' ? 'top' : 'center'),
          sectionId: pendingMeta?.sectionId || prev?.sectionId || null,
          rotation: pendingMeta?.rotation || prev?.rotation || { x: 0, y: 0, z: 0 },
        }
      })
      const footings = (payload.footings || []).map((f) => {
        const prev = existingFootings[f.id]
        return {
          ...f,
          sectionId: prev?.sectionId || null,
        }
      })
      return {
        ...m,
        nodes: payload.nodes || [],
        members,
        footings: payload.footings ? footings : m.footings,
      }
    })
  }

  function handleSelectionChange(selection){
    setModel(m => setSelection(m, selection))
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

  useEffect(() => {
    saveModel(model)
  }, [model])

  function applyModel(nextModel){
    setModel(nextModel)
    if (threeRef.current && typeof threeRef.current.setModel === 'function'){
      threeRef.current.setModel(nextModel)
    }
  }

  function handleReset(){
    applyModel(createEmptyModel())
  }

  function handleExport(){
    const json = JSON.stringify(model, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ossm-model.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(file){
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try{
        const parsed = JSON.parse(String(reader.result || ''))
        applyModel(normalizeModel(parsed))
      }catch(e){
        // ignore invalid json
      }
    }
    reader.readAsText(file)
  }

  function handleImportClick(){
    importRef.current && importRef.current.click()
  }

  function addFootingToSelected(){
    if (!model.selection || model.selection.type !== 'node') return
    const nodeId = model.selection.id
    if (!nodeId || !threeRef.current || typeof threeRef.current.addFooting !== 'function') return
    threeRef.current.addFooting(nodeId, footingSize)
  }

  function applyTransform({ translate, rotate }){
    let next = model
    if (translate) next = translateSelection(next, next.selection, translate)
    if (rotate && next.selection?.type === 'footing') next = rotateFooting(next, next.selection.id, rotate)
    if (rotate && next.selection?.type === 'member') next = rotateMember(next, next.selection.id, rotate)
    applyModel(next)
  }

  function handleAddFloor(){
    applyModel(addFloor(model, { name: floorName || undefined, elevation: Number(floorElev) || 0 }))
    setFloorName('')
  }

  function handleUpdateFloor(id, patch){
    applyModel(updateFloor(model, id, patch))
  }

  function handleRemoveFloor(id){
    applyModel(removeFloor(model, id))
  }

  function handleAddSection(){
    const name = sectionForm.name || `${sectionForm.category} ${model.sections.length + 1}`
    const dims = { b: Number(sectionForm.b) || 0, h: Number(sectionForm.h) || 0 }
    applyModel(addSection(model, { name, category: sectionForm.category, shape: sectionForm.shape, dims }))
    setSectionForm(s => ({ ...s, name: '' }))
  }

  function handleRemoveSection(id){
    applyModel(removeSection(model, id))
  }

  function updateMemberMeta(memberId, patch){
    const normalize = { ...patch }
    if ('sectionId' in patch && !patch.sectionId) {
      normalize.sectionId = null
      normalize.align = 'center'
    }
    applyModel({
      ...model,
      members: model.members.map((m) => (m.id === memberId ? { ...m, ...normalize } : m)),
    })
  }

  function applyDetailingToMember(){
    if (!detailingState || model.selection?.type !== 'member') return
    const memberId = model.selection.id
    updateMemberMeta(memberId, { detailing: detailingState })
  }

  function updateFootingMeta(footingId, patch){
    applyModel({
      ...model,
      footings: model.footings.map((f) => (f.id === footingId ? { ...f, ...patch } : f)),
    })
  }

  function duplicateNode(){
    if (model.selection?.type !== 'node') return
    const node = model.nodes.find((n) => n.id === model.selection.id)
    if (!node) return
    const pos = node.position
    const nextPos = new THREE.Vector3(
      (pos?.x || 0) + (dupOffset.x || 0),
      (pos?.y || 0) + (dupOffset.y || 0),
      (pos?.z || 0) + (dupOffset.z || 0)
    )
    if (threeRef.current && typeof threeRef.current.addNode === 'function'){
      threeRef.current.addNode(nextPos)
    }
  }

  function duplicateMember(){
    if (model.selection?.type !== 'member') return
    const member = model.members.find((m) => m.id === model.selection.id)
    if (!member) return
    const a = model.nodes.find((n) => n.id === member.a)
    const b = model.nodes.find((n) => n.id === member.b)
    if (!a || !b) return
    const offset = dupOffset
    const aPos = a.position || { x: 0, y: 0, z: 0 }
    const bPos = b.position || { x: 0, y: 0, z: 0 }
    const newA = new THREE.Vector3(aPos.x + (offset.x || 0), aPos.y + (offset.y || 0), aPos.z + (offset.z || 0))
    const newB = new THREE.Vector3(bPos.x + (offset.x || 0), bPos.y + (offset.y || 0), bPos.z + (offset.z || 0))
    if (!threeRef.current || typeof threeRef.current.addNode !== 'function' || typeof threeRef.current.addMember !== 'function') return
    const aId = threeRef.current.addNode(newA)
    const bId = threeRef.current.addNode(newB)
    if (!aId || !bId) return
    const newMemberId = threeRef.current.addMember(aId, bId)
    if (newMemberId) {
      pendingMemberMetaRef.current[newMemberId] = {
        type: member.type || 'beam',
        sectionId: member.sectionId || null,
        align: member.align || 'center',
        rotation: member.rotation || { x: 0, y: 0, z: 0 },
      }
    }
  }

  function splitSelectedMember(){
    if (model.selection?.type !== 'member') return
    const member = model.members.find((m) => m.id === model.selection.id)
    if (!member) return
    const a = model.nodes.find((n) => n.id === member.a)
    const b = model.nodes.find((n) => n.id === member.b)
    if (!a || !b) return
    const mid = {
      x: (a.position.x + b.position.x) / 2,
      y: (a.position.y + b.position.y) / 2,
      z: (a.position.z + b.position.z) / 2,
    }
    if (!threeRef.current) return
    const midId = threeRef.current.addNode(new THREE.Vector3(mid.x, mid.y, mid.z))
    if (!midId) return
    const meta = {
      type: member.type || 'beam',
      sectionId: member.sectionId || null,
      align: member.align || 'center',
      rotation: member.rotation || { x: 0, y: 0, z: 0 },
    }
    const m1 = threeRef.current.addMember(member.a, midId)
    const m2 = threeRef.current.addMember(midId, member.b)
    if (m1) pendingMemberMetaRef.current[m1] = meta
    if (m2) pendingMemberMetaRef.current[m2] = meta
    if (typeof threeRef.current.deleteMember === 'function') {
      threeRef.current.deleteMember(member.id)
    }
  }

  function splitSelectedMemberAtIntersections(){
    if (model.selection?.type !== 'member') return
    const member = model.members.find((m) => m.id === model.selection.id)
    if (!member) return
    const a = model.nodes.find((n) => n.id === member.a)
    const b = model.nodes.find((n) => n.id === member.b)
    if (!a || !b) return
    const ax = a.position.x
    const az = a.position.z
    const bx = b.position.x
    const bz = b.position.z
    const intersections = []
    for (const other of model.members){
      if (other.id === member.id) continue
      if (other.a === member.a || other.a === member.b || other.b === member.a || other.b === member.b) continue
      const oa = model.nodes.find((n) => n.id === other.a)
      const ob = model.nodes.find((n) => n.id === other.b)
      if (!oa || !ob) continue
      const cx = oa.position.x
      const cz = oa.position.z
      const dx = ob.position.x
      const dz = ob.position.z
      const denom = (ax - bx) * (cz - dz) - (az - bz) * (cx - dx)
      if (Math.abs(denom) < 1e-9) continue
      const t = ((ax - cx) * (cz - dz) - (az - cz) * (cx - dx)) / denom
      const u = ((ax - cx) * (az - bz) - (az - cz) * (ax - bx)) / denom
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue
      const ix = ax + t * (bx - ax)
      const iz = az + t * (bz - az)
      intersections.push({ ix, iz, other })
    }
    if (!intersections.length || !threeRef.current) return
    const pick = intersections[0]
    const iy = model.snapToLevel && activeLevel ? activeLevel.elevation : (a.position.y + b.position.y) / 2
    const nodeId = threeRef.current.addNode(new THREE.Vector3(pick.ix, iy, pick.iz))
    if (!nodeId) return
    const meta = {
      type: member.type || 'beam',
      sectionId: member.sectionId || null,
      align: member.align || 'center',
      rotation: member.rotation || { x: 0, y: 0, z: 0 },
      detailing: member.detailing || null,
    }
    const m1 = threeRef.current.addMember(member.a, nodeId)
    const m2 = threeRef.current.addMember(nodeId, member.b)
    if (m1) pendingMemberMetaRef.current[m1] = meta
    if (m2) pendingMemberMetaRef.current[m2] = meta
    if (typeof threeRef.current.deleteMember === 'function') {
      threeRef.current.deleteMember(member.id)
    }
    const other = pick.other
    const m3 = threeRef.current.addMember(other.a, nodeId)
    const m4 = threeRef.current.addMember(nodeId, other.b)
    if (m3) pendingMemberMetaRef.current[m3] = {
      type: other.type || 'beam',
      sectionId: other.sectionId || null,
      align: other.align || 'center',
      rotation: other.rotation || { x: 0, y: 0, z: 0 },
      detailing: other.detailing || null,
    }
    if (m4) pendingMemberMetaRef.current[m4] = {
      type: other.type || 'beam',
      sectionId: other.sectionId || null,
      align: other.align || 'center',
      rotation: other.rotation || { x: 0, y: 0, z: 0 },
      detailing: other.detailing || null,
    }
    if (typeof threeRef.current.deleteMember === 'function') {
      threeRef.current.deleteMember(other.id)
    }
  }

  function joinSelectedMember(){
    if (model.selection?.type !== 'member') return
    const member = model.members.find((m) => m.id === model.selection.id)
    if (!member) return
    const other = model.members.find((m) => {
      if (m.id === member.id) return false
      return m.a === member.a || m.a === member.b || m.b === member.a || m.b === member.b
    })
    if (!other) return
    const shared = [member.a, member.b].find((id) => id === other.a || id === other.b)
    if (!shared) return
    const a1 = member.a === shared ? member.b : member.a
    const b1 = other.a === shared ? other.b : other.a
    const pShared = model.nodes.find((n) => n.id === shared)?.position
    const pA = model.nodes.find((n) => n.id === a1)?.position
    const pB = model.nodes.find((n) => n.id === b1)?.position
    if (!pShared || !pA || !pB) return
    const v1 = new THREE.Vector3(pA.x - pShared.x, pA.y - pShared.y, pA.z - pShared.z).normalize()
    const v2 = new THREE.Vector3(pB.x - pShared.x, pB.y - pShared.y, pB.z - pShared.z).normalize()
    const collinear = Math.abs(v1.dot(v2)) > 0.99
    if (!collinear) return
    if (!threeRef.current) return
    const newMemberId = threeRef.current.addMember(a1, b1)
    if (newMemberId) {
      pendingMemberMetaRef.current[newMemberId] = {
        type: member.type || 'beam',
        sectionId: member.sectionId || null,
        align: member.align || 'center',
        rotation: member.rotation || { x: 0, y: 0, z: 0 },
      }
    }
    if (typeof threeRef.current.deleteMember === 'function') {
      threeRef.current.deleteMember(member.id)
      threeRef.current.deleteMember(other.id)
    }
  }

  function autoSplitAllIntersections(){
    if (!threeRef.current) return
    const members = model.members || []
    if (members.length < 2) return
    const nodesById = Object.fromEntries(model.nodes.map((n) => [n.id, n]))
    const intersectionsByKey = {}
    const perMember = {}

    function getOrCreateNodeId(ix, iy, iz){
      const key = `${ix.toFixed(4)}|${iy.toFixed(4)}|${iz.toFixed(4)}`
      if (intersectionsByKey[key]) return intersectionsByKey[key]
      const nodeId = threeRef.current.addNode(new THREE.Vector3(ix, iy, iz))
      if (!nodeId) return null
      intersectionsByKey[key] = nodeId
      return nodeId
    }

    function avgYForMember(m){
      const a = nodesById[m.a]?.position
      const b = nodesById[m.b]?.position
      if (!a || !b) return 0
      return (a.y + b.y) / 2
    }

    const eps = 1e-6
    for (let i = 0; i < members.length; i++){
      const m1 = members[i]
      const a1 = nodesById[m1.a]?.position
      const b1 = nodesById[m1.b]?.position
      if (!a1 || !b1) continue
      for (let j = i + 1; j < members.length; j++){
        const m2 = members[j]
        const a2 = nodesById[m2.a]?.position
        const b2 = nodesById[m2.b]?.position
        if (!a2 || !b2) continue
        const denom = (a1.x - b1.x) * (a2.z - b2.z) - (a1.z - b1.z) * (a2.x - b2.x)
        if (Math.abs(denom) < eps) {
          // collinear overlap: split at endpoints
          const vx = b1.x - a1.x
          const vz = b1.z - a1.z
          const wx = a2.x - a1.x
          const wz = a2.z - a1.z
          if (Math.abs(vx * wz - vz * wx) > eps) continue
          const lenSq1 = vx * vx + vz * vz
          const lenSq2 = (b2.x - a2.x) * (b2.x - a2.x) + (b2.z - a2.z) * (b2.z - a2.z)
          if (lenSq1 < eps || lenSq2 < eps) continue
          const tA2 = ((a2.x - a1.x) * vx + (a2.z - a1.z) * vz) / lenSq1
          const tB2 = ((b2.x - a1.x) * vx + (b2.z - a1.z) * vz) / lenSq1
          if (tA2 > eps && tA2 < 1 - eps) {
            if (!perMember[m1.id]) perMember[m1.id] = []
            perMember[m1.id].push({ t: tA2, nodeId: m2.a })
          }
          if (tB2 > eps && tB2 < 1 - eps) {
            if (!perMember[m1.id]) perMember[m1.id] = []
            perMember[m1.id].push({ t: tB2, nodeId: m2.b })
          }
          const ux = b2.x - a2.x
          const uz = b2.z - a2.z
          const lenSqU = ux * ux + uz * uz
          const tA1 = ((a1.x - a2.x) * ux + (a1.z - a2.z) * uz) / lenSqU
          const tB1 = ((b1.x - a2.x) * ux + (b1.z - a2.z) * uz) / lenSqU
          if (tA1 > eps && tA1 < 1 - eps) {
            if (!perMember[m2.id]) perMember[m2.id] = []
            perMember[m2.id].push({ t: tA1, nodeId: m1.a })
          }
          if (tB1 > eps && tB1 < 1 - eps) {
            if (!perMember[m2.id]) perMember[m2.id] = []
            perMember[m2.id].push({ t: tB1, nodeId: m1.b })
          }
        } else {
          if (m2.a === m1.a || m2.a === m1.b || m2.b === m1.a || m2.b === m1.b) continue
          const t = ((a1.x - a2.x) * (a2.z - b2.z) - (a1.z - a2.z) * (a2.x - b2.x)) / denom
          const u = ((a1.x - a2.x) * (a1.z - b1.z) - (a1.z - a2.z) * (a1.x - b1.x)) / denom
          if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue
          const ix = a1.x + t * (b1.x - a1.x)
          const iz = a1.z + t * (b1.z - a1.z)
          const iy = model.snapToLevel && activeLevel
            ? activeLevel.elevation
            : (avgYForMember(m1) + avgYForMember(m2)) / 2
          const nodeId = getOrCreateNodeId(ix, iy, iz)
          if (!nodeId) continue
          if (!perMember[m1.id]) perMember[m1.id] = []
          if (!perMember[m2.id]) perMember[m2.id] = []
          perMember[m1.id].push({ t, nodeId })
          perMember[m2.id].push({ t: u, nodeId })
        }
      }
    }

    Object.entries(perMember).forEach(([memberId, list]) => {
      const member = members.find((m) => m.id === memberId)
      if (!member) return
      const sorted = [...list].sort((a, b) => a.t - b.t)
      const seen = new Set()
      const unique = []
      for (const item of sorted) {
        if (seen.has(item.nodeId)) continue
        seen.add(item.nodeId)
        unique.push(item)
      }
      const chain = [member.a, ...unique.map((s) => s.nodeId), member.b]
      const meta = {
        type: member.type || 'beam',
        sectionId: member.sectionId || null,
        align: member.align || 'center',
        rotation: member.rotation || { x: 0, y: 0, z: 0 },
        detailing: member.detailing || null,
      }
      for (let i = 0; i < chain.length - 1; i++){
        const newMemberId = threeRef.current.addMember(chain[i], chain[i + 1])
        if (newMemberId) pendingMemberMetaRef.current[newMemberId] = meta
      }
      if (typeof threeRef.current.deleteMember === 'function') {
        threeRef.current.deleteMember(member.id)
      }
    })
  }

  function onRequestDelete(req){
    // req: { type: 'node'|'member'|'footing', id }
    if (!req) return
    const label = req.type === 'node'
      ? `Node ${req.id.slice(0,6)}`
      : req.type === 'footing'
        ? `Footing ${req.id.slice(0,6)}`
        : `Member ${req.id.slice(0,6)}`
    setPendingDelete({ ...req, label })
  }

  function confirmDelete(){
    if (!pendingDelete) return
    const { type, id } = pendingDelete
    // prepare undo payload from current scene state
    if (type === 'node'){
      const node = model.nodes.find(n=>n.id===id)
      const attached = model.members.filter(m=>m.a===id || m.b===id)
      // delete
      if (threeRef.current && typeof threeRef.current.deleteNode === 'function'){
        threeRef.current.deleteNode(id)
      }
      // push undo
      const undo = { type:'node', node, attached }
      scheduleUndo(undo)
    } else if (type === 'member'){
      const member = model.members.find(m=>m.id===id)
      if (threeRef.current && typeof threeRef.current.deleteMember === 'function'){
        threeRef.current.deleteMember(id)
      }
      const undo = { type:'member', member }
      scheduleUndo(undo)
    } else if (type === 'footing'){
      const footing = model.footings.find(f=>f.id===id)
      if (threeRef.current && typeof threeRef.current.deleteFooting === 'function'){
        threeRef.current.deleteFooting(id)
      }
      const undo = { type:'footing', footing }
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
      } else if (item.type === 'footing'){
        const f = item.footing
        if (threeRef.current && typeof threeRef.current.addFooting === 'function'){
          threeRef.current.addFooting(f.nodeId, f.size)
        }
      }
      return rest
    })
  }

  const selectedMember = model.selection?.type === 'member'
    ? model.members.find((m) => m.id === model.selection.id)
    : null
  const selectedMemberSection = selectedMember?.sectionId
    ? model.sections.find((s) => s.id === selectedMember.sectionId)
    : null
  const missingTopAlignHeight = selectedMember?.align === 'top' && !Number.isFinite(selectedMemberSection?.dims?.h)
  const activeLevel = model.activeLevelId
    ? model.floors.find((f) => f.id === model.activeLevelId)
    : null
  const sectionPreview = selectedMemberSection
    ? {
        b: Number(selectedMemberSection.dims?.b) || 0,
        h: Number(selectedMemberSection.dims?.h) || 0,
      }
    : null
  const sectionPreviewScale = sectionPreview
    ? Math.max(sectionPreview.b, sectionPreview.h, 1)
    : 1

  return (
    <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
      <header style={{padding: 12, background: '#0f172a', color: '#fff', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        OSSM — Open-Source Structural Modeler
        <div style={{display:'flex', gap:8}}>
          <button onClick={handleExport} style={{padding:'6px 10px'}}>Export JSON</button>
          <button onClick={handleImportClick} style={{padding:'6px 10px'}}>Import JSON</button>
          <button onClick={handleReset} style={{padding:'6px 10px'}}>Reset Project</button>
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            onChange={(e)=> {
              handleImportFile(e.target.files && e.target.files[0])
              e.target.value = ''
            }}
            style={{display:'none'}}
          />
        </div>
      </header>
      <div style={{flex:1, display:'flex', minHeight:0}}>
        <TreeSidebar
          open={true}
          onToggle={() => { /* toggled by internal button for now */ }}
          nodes={model.nodes}
          members={model.members}
          footings={model.footings}
          floors={model.floors}
          sections={model.sections}
          onSelect={(sel)=>{
            if (!sel || !threeRef.current) return
            if (sel.type === 'member' && typeof threeRef.current.selectMember === 'function') {
              threeRef.current.selectMember(sel.id)
            } else if (sel.type === 'footing' && typeof threeRef.current.selectFooting === 'function') {
              threeRef.current.selectFooting(sel.id)
            } else if (sel.type === 'node' && typeof threeRef.current.selectNode === 'function') {
              threeRef.current.selectNode(sel.id)
            }
          }}
          onRequestDelete={(req)=> onRequestDelete(req)}
          onRequestDeleteMember={(id)=> onRequestDelete({ type: 'member', id })}
          selectedDia={dia}
          setSelectedDia={setDia}
          rebarLib={rebarLib}
        />
        <SectionEditor onSectionChange={setDetailingState} selectedDia={dia} setSelectedDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} addBomLine={addBomLine} />
        <div style={{flex:1, display:'flex', flexDirection:'column'}}>
          <div style={{padding:10, borderBottom:'1px solid #eef2f7', background:'#fbfdff'}}>
            <strong>Section Summary</strong>
            {!detailingState && <div style={{color:'#666'}}>No detailing data</div>}
            {detailingState && (
              <div style={{display:'flex', gap:12, alignItems:'center', marginTop:6, flexWrap:'wrap'}}>
                <div><strong>Dia:</strong> {detailingState.diaLabel}</div>
                <div><strong>Spacing:</strong> {detailingState.spacing} mm</div>
                <div><strong>Layers:</strong> {detailingState.layersCount}</div>
                <div style={{color: detailingState.errors?.length ? '#b91c1c' : '#166534'}}>
                  {detailingState.errors?.length ? `${detailingState.errors.length} NSCP issue(s)` : 'NSCP OK'}
                </div>
              </div>
            )}
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10}}>
              <div style={{fontWeight:600}}>Footing</div>
              <label style={{fontSize:12}}>
                B
                <input
                  type="number"
                  step="0.1"
                  value={footingSize.x}
                  onChange={(e)=> setFootingSize(s => ({ ...s, x: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                D
                <input
                  type="number"
                  step="0.1"
                  value={footingSize.y}
                  onChange={(e)=> setFootingSize(s => ({ ...s, y: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                L
                <input
                  type="number"
                  step="0.1"
                  value={footingSize.z}
                  onChange={(e)=> setFootingSize(s => ({ ...s, z: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <button
                onClick={addFootingToSelected}
                disabled={model.selection?.type !== 'node'}
                style={{padding:'6px 10px'}}
              >
                Add Footing to Selected Node
              </button>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Levels & NGL</div>
              <label style={{fontSize:12}}>
                NGL
                <input
                  type="number"
                  step="0.1"
                  value={model.ngl || 0}
                  onChange={(e)=> applyModel({ ...model, ngl: Number(e.target.value) || 0 })}
                  style={{width:80, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                Show Vertical Grid
                <input
                  type="checkbox"
                  checked={!!model.showVerticalGrid}
                  onChange={(e)=> applyModel({ ...model, showVerticalGrid: e.target.checked })}
                  style={{marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                Snap to Level
                <input
                  type="checkbox"
                  checked={!!model.snapToLevel}
                  onChange={(e)=> applyModel({ ...model, snapToLevel: e.target.checked })}
                  style={{marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                Active Level
                <select
                  value={model.activeLevelId || ''}
                  onChange={(e)=> applyModel({ ...model, activeLevelId: e.target.value || null })}
                  style={{marginLeft:6}}
                >
                  <option value="">None</option>
                  {model.floors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name || 'Floor'} @ {Number(f.elevation || 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              {activeLevel && (
                <div style={{fontSize:12, color:'#475569'}}>
                  Level Y: {Number(activeLevel.elevation || 0).toFixed(2)}
                </div>
              )}
              <label style={{fontSize:12}}>
                Floor Name
                <input
                  type="text"
                  value={floorName}
                  onChange={(e)=> setFloorName(e.target.value)}
                  style={{width:120, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                Elevation
                <input
                  type="number"
                  step="0.1"
                  value={floorElev}
                  onChange={(e)=> setFloorElev(Number(e.target.value) || 0)}
                  style={{width:80, marginLeft:6}}
                />
              </label>
              <button onClick={handleAddFloor} style={{padding:'6px 10px'}}>Add Floor</button>
            </div>
            {model.floors && model.floors.length > 0 && (
              <div style={{marginTop:8}}>
                {model.floors.map((f) => (
                  <div key={f.id} style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                    <input
                      type="text"
                      value={f.name}
                      onChange={(e)=> handleUpdateFloor(f.id, { name: e.target.value })}
                      style={{width:140}}
                    />
                    <input
                      type="number"
                      step="0.1"
                      value={f.elevation}
                      onChange={(e)=> handleUpdateFloor(f.id, { elevation: Number(e.target.value) || 0 })}
                      style={{width:90}}
                    />
                    <button onClick={()=> handleRemoveFloor(f.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Section Properties</div>
              <label style={{fontSize:12}}>
                Category
                <select
                  value={sectionForm.category}
                  onChange={(e)=> setSectionForm(s => ({ ...s, category: e.target.value }))}
                  style={{marginLeft:6}}
                >
                  <option value="beam">Beam</option>
                  <option value="column">Column</option>
                  <option value="pedestal">Pedestal</option>
                  <option value="footing">Footing</option>
                </select>
              </label>
              <label style={{fontSize:12}}>
                Name
                <input
                  type="text"
                  value={sectionForm.name}
                  onChange={(e)=> setSectionForm(s => ({ ...s, name: e.target.value }))}
                  style={{width:140, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                b
                <input
                  type="number"
                  step="0.01"
                  value={sectionForm.b}
                  onChange={(e)=> setSectionForm(s => ({ ...s, b: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                h
                <input
                  type="number"
                  step="0.01"
                  value={sectionForm.h}
                  onChange={(e)=> setSectionForm(s => ({ ...s, h: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <button onClick={handleAddSection} style={{padding:'6px 10px'}}>Add Section</button>
            </div>
            {model.sections && model.sections.length > 0 && (
              <div style={{marginTop:8}}>
                {model.sections.map((s) => (
                  <div key={s.id} style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                    <div style={{minWidth:110, fontSize:12}}>{s.category}</div>
                    <div style={{flex:1, fontSize:12}}>{s.name}</div>
                    <button onClick={()=> handleRemoveSection(s.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Selection</div>
              <div style={{fontSize:12}}>
                {model.selection?.type ? `${model.selection.type} ${model.selection.id?.slice(0,6)}` : 'None'}
              </div>
              {model.selection?.type === 'member' && (
                <>
                  <label style={{fontSize:12}}>
                    Type
                    <select
                      value={(model.members.find(m => m.id === model.selection.id)?.type) || 'beam'}
                      onChange={(e)=> updateMemberMeta(model.selection.id, { type: e.target.value })}
                      style={{marginLeft:6}}
                    >
                      <option value="beam">Beam</option>
                      <option value="column">Column</option>
                      <option value="pedestal">Pedestal</option>
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Align
                    <select
                      value={(model.members.find(m => m.id === model.selection.id)?.align) || 'center'}
                      onChange={(e)=> updateMemberMeta(model.selection.id, { align: e.target.value })}
                      style={{marginLeft:6}}
                    >
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Section
                    <select
                      value={(model.members.find(m => m.id === model.selection.id)?.sectionId) || ''}
                      onChange={(e)=> updateMemberMeta(model.selection.id, { sectionId: e.target.value || null })}
                      style={{marginLeft:6}}
                    >
                      <option value="">None</option>
                      {model.sections.filter(s => s.category === (model.members.find(m => m.id === model.selection.id)?.type || 'beam')).map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  {selectedMemberSection && (
                    <div style={{fontSize:12, color:'#475569'}}>
                      h: {Number.isFinite(selectedMemberSection?.dims?.h) ? selectedMemberSection.dims.h : 'n/a'}
                    </div>
                  )}
                  {sectionPreview && (
                    <svg width="60" height="60" style={{border:'1px solid #e2e8f0', borderRadius:4}}>
                      <rect
                        x={(60 - (sectionPreview.b / sectionPreviewScale) * 40) / 2}
                        y={(60 - (sectionPreview.h / sectionPreviewScale) * 40) / 2}
                        width={(sectionPreview.b / sectionPreviewScale) * 40}
                        height={(sectionPreview.h / sectionPreviewScale) * 40}
                        fill="#e2e8f0"
                        stroke="#64748b"
                      />
                    </svg>
                  )}
                  <button onClick={applyDetailingToMember} disabled={!detailingState} style={{padding:'6px 10px'}}>
                    Apply Detailing
                  </button>
                  {selectedMember?.detailing && (
                    <div style={{fontSize:12, color:'#475569'}}>
                      Detailing: {selectedMember.detailing?.diaLabel || 'n/a'} @ {selectedMember.detailing?.spacing || 'n/a'} mm
                    </div>
                  )}
                  <button onClick={splitSelectedMember} style={{padding:'6px 10px'}}>Split Member</button>
                  <button onClick={splitSelectedMemberAtIntersections} style={{padding:'6px 10px'}}>Split at Intersection</button>
                  <button onClick={joinSelectedMember} style={{padding:'6px 10px'}}>Join Collinear</button>
                </>
              )}
              {missingTopAlignHeight && (
                <div style={{fontSize:12, color:'#b45309'}}>
                  Top align needs a section with height (h). Assign a section to offset the centroid.
                </div>
              )}
              {model.selection?.type === 'footing' && (
                <label style={{fontSize:12}}>
                  Section
                  <select
                    value={(model.footings.find(f => f.id === model.selection.id)?.sectionId) || ''}
                    onChange={(e)=> updateFootingMeta(model.selection.id, { sectionId: e.target.value || null })}
                    style={{marginLeft:6}}
                  >
                    <option value="">None</option>
                    {model.sections.filter(s => s.category === 'footing').map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Constraints</div>
              <label style={{fontSize:12}}>
                Axis Lock
                <select
                  value={model.axisLock || 'none'}
                  onChange={(e)=> applyModel({ ...model, axisLock: e.target.value || 'none' })}
                  style={{marginLeft:6}}
                >
                  <option value="none">None</option>
                  <option value="x">X</option>
                  <option value="y">Y</option>
                  <option value="z">Z</option>
                </select>
              </label>
              <label style={{fontSize:12}}>
                Constrain Members V/H
                <input
                  type="checkbox"
                  checked={!!model.constrainMembers}
                  onChange={(e)=> applyModel({ ...model, constrainMembers: e.target.checked })}
                  style={{marginLeft:6}}
                />
              </label>
              <button onClick={autoSplitAllIntersections} disabled={model.members.length < 2} style={{padding:'6px 10px'}}>
                Auto-Split Intersections
              </button>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Duplicate</div>
              <label style={{fontSize:12}}>
                dX
                <input
                  type="number"
                  step="0.1"
                  value={dupOffset.x}
                  onChange={(e)=> setDupOffset(s => ({ ...s, x: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                dY
                <input
                  type="number"
                  step="0.1"
                  value={dupOffset.y}
                  onChange={(e)=> setDupOffset(s => ({ ...s, y: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                dZ
                <input
                  type="number"
                  step="0.1"
                  value={dupOffset.z}
                  onChange={(e)=> setDupOffset(s => ({ ...s, z: Number(e.target.value) || 0 }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <button onClick={duplicateNode} disabled={model.selection?.type !== 'node'}>Duplicate Node</button>
              <button onClick={duplicateMember} disabled={model.selection?.type !== 'member'}>Duplicate Member</button>
            </div>
          </div>
          <div style={{flex:1}}>
            <ThreeScene
              ref={threeRef}
              model={model}
              initialModel={initialModelRef.current}
              floors={model.floors}
              nglElevation={model.ngl}
              showVerticalGrid={!!model.showVerticalGrid}
              snapToLevel={!!model.snapToLevel}
              activeLevelId={model.activeLevelId}
              axisLock={model.axisLock}
              constrainMembers={!!model.constrainMembers}
              onSceneChange={handleSceneChange}
              onSelectionChange={handleSelectionChange}
              onRequestDelete={(req)=> onRequestDelete(req)}
            />
          </div>
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
