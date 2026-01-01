import React, { useState, useRef, useEffect } from 'react'
import * as THREE from 'three'
import { FiBox, FiEdit3, FiLayers, FiClipboard } from 'react-icons/fi'
import ThreeScene from './components/ThreeScene'
import SectionEditor from './components/SectionEditor'
import BOMPanel from './components/BOMPanel'
import TreeSidebar from './components/TreeSidebar'
import ConfirmModal from './components/ConfirmModal'
import { auth, db, hasConfig } from './utils/firebase'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
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
    material: 'rc',
    shape: 'rect',
    b: 0.3,
    h: 0.5,
    centroid: 'center',
    steelType: 'W',
    steelShape: '',
  })
  const [detailingState, setDetailingState] = useState(null)
  const [dupOffset, setDupOffset] = useState({ x: 1, y: 0, z: 0 })
  const [treeOpen, setTreeOpen] = useState(true)
  const [activeTab, setActiveTab] = useState('modeling')
  const [panelOpen, setPanelOpen] = useState(true)
  const [nodeInput, setNodeInput] = useState({ x: 0, y: 0, z: 0 })
  const [memberInputA, setMemberInputA] = useState('')
  const [memberInputB, setMemberInputB] = useState('')
  const [rotateEnabled, setRotateEnabled] = useState(false)
  const [lineDrawMode, setLineDrawMode] = useState(false)
  const [lineStartId, setLineStartId] = useState(null)
  const [firebaseUid, setFirebaseUid] = useState(null)
  const [isPremium, setIsPremium] = useState(false)
  const [customShapes, setCustomShapes] = useState([])
  const [customShapeId, setCustomShapeId] = useState('')
  const [aiscShapes, setAiscShapes] = useState([])
  const [aiscUnits, setAiscUnits] = useState('metric')
  const [detailTargetSectionId, setDetailTargetSectionId] = useState(null)
  const [selectedMemberIds, setSelectedMemberIds] = useState([])
  const devUserDocEnabled = import.meta.env.VITE_DEV_USER_DOC === '1'

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
    if (selection?.type === 'member' && Array.isArray(selection.multi)) {
      setSelectedMemberIds(selection.multi)
    } else if (!selection || selection.type !== 'member') {
      setSelectedMemberIds([])
    }
    if (!selection || selection.type !== 'node' || !lineDrawMode) return
    if (!lineStartId) {
      setLineStartId(selection.id)
      return
    }
    if (lineStartId === selection.id) return
    if (threeRef.current && typeof threeRef.current.addMember === 'function'){
      threeRef.current.addMember(lineStartId, selection.id)
    }
    setLineStartId(null)
  }

  useEffect(() => {
    if (model.selection?.type !== 'node') return
    const node = model.nodes.find((n) => n.id === model.selection.id)
    if (!node) return
    setNodeInput({
      x: node.position.x,
      y: node.position.y,
      z: node.position.z,
    })
  }, [model.selection, model.nodes])

  useEffect(() => {
    const ids = model.nodes.map((n) => n.id)
    if (ids.length === 0) {
      setMemberInputA('')
      setMemberInputB('')
      return
    }
    setMemberInputA((prev) => (ids.includes(prev) ? prev : ids[0]))
    setMemberInputB((prev) => {
      if (ids.includes(prev)) return prev
      return ids[1] || ids[0]
    })
  }, [model.nodes])

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
    async function fetchAisc(){
      try{
        const res = await fetch(`http://localhost:4000/api/aisc?units=${aiscUnits}`)
        if (!res.ok) return
        const json = await res.json()
        setAiscUnits(String(json.units || 'metric'))
        setAiscShapes(Array.isArray(json.shapes) ? json.shapes : [])
      }catch(e){ /* ignore */ }
    }
    fetchAisc()
  }, [aiscUnits])

  useEffect(() => {
    if (!hasConfig || !auth) return
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUid(user.uid)
      } else {
        signInAnonymously(auth).catch(() => {})
      }
    })
    return () => unsub()
  }, [])

  async function loadCustomShapes(uid){
    if (!db || !uid) return
    const q = query(collection(db, 'custom_shapes'), where('uid', '==', uid))
    const snap = await getDocs(q)
    const items = []
    snap.forEach((doc) => items.push({ id: doc.id, ...doc.data() }))
    setCustomShapes(items)
  }

  useEffect(() => {
    if (!firebaseUid) return
    loadCustomShapes(firebaseUid)
  }, [firebaseUid])

  useEffect(() => {
    if (!aiscShapes.length) return
    const types = Array.from(new Set(aiscShapes.map((s) => s.type))).filter(Boolean).sort()
    if (!types.length) return
    setSectionForm((prev) => {
      const steelType = types.includes(prev.steelType) ? prev.steelType : types[0]
      const shapesForType = aiscShapes.filter((s) => s.type === steelType)
      const steelShape = prev.steelShape && shapesForType.find((s) => s.label === prev.steelShape)
        ? prev.steelShape
        : (shapesForType[0]?.label || '')
      return { ...prev, steelType, steelShape }
    })
  }, [aiscShapes])

  useEffect(() => {
    if (activeTab !== 'modeling') {
      setLineDrawMode(false)
      setLineStartId(null)
    }
  }, [activeTab])

  useEffect(() => {
    if (!db || !firebaseUid) return
    const userRef = doc(db, 'users', firebaseUid)
    getDoc(userRef).then((snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setIsPremium(!!data.premium)
      } else {
        setIsPremium(false)
      }
    }).catch(() => setIsPremium(false))
  }, [firebaseUid])

  useEffect(() => {
    saveModel(model)
  }, [model])

  function applyModel(nextModel){
    setModel(nextModel)
    if (threeRef.current && typeof threeRef.current.setModel === 'function'){
      threeRef.current.setModel(nextModel)
    }
  }

  function handleTabClick(tabKey){
    if (activeTab === tabKey) {
      setPanelOpen((prev) => !prev)
      return
    }
    setActiveTab(tabKey)
    setPanelOpen(tabKey !== 'bom')
  }

  function toggleRotateMode(){
    setRotateEnabled((prev) => {
      const next = !prev
      if (threeRef.current && typeof threeRef.current.setRotateMode === 'function') {
        threeRef.current.setRotateMode(next)
      }
      return next
    })
  }

  function clearSelection(){
    updateMultiSelection([])
    if (threeRef.current && typeof threeRef.current.clearSelection === 'function') {
      threeRef.current.clearSelection()
    } else {
      applyModel(setSelection(model, { type: null, id: null }))
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

  function handleAddNodeFromInput(){
    if (!threeRef.current || typeof threeRef.current.addNode !== 'function') return
    const x = Number(nodeInput.x) || 0
    const y = Number(nodeInput.y) || 0
    const z = Number(nodeInput.z) || 0
    threeRef.current.addNode(new THREE.Vector3(x, y, z))
  }

  function handleUpdateSelectedNode(){
    if (model.selection?.type !== 'node') return
    const x = Number(nodeInput.x) || 0
    const y = Number(nodeInput.y) || 0
    const z = Number(nodeInput.z) || 0
    const next = {
      ...model,
      nodes: model.nodes.map((n) => (
        n.id === model.selection.id ? { ...n, position: { x, y, z } } : n
      )),
    }
    applyModel(next)
  }

  function handleDeleteSelectedNode(){
    if (model.selection?.type !== 'node') return
    if (threeRef.current && typeof threeRef.current.deleteNode === 'function'){
      threeRef.current.deleteNode(model.selection.id)
    }
  }

  function handleAddMemberFromInput(){
    if (!threeRef.current || typeof threeRef.current.addMember !== 'function') return
    if (!memberInputA || !memberInputB || memberInputA === memberInputB) return
    threeRef.current.addMember(memberInputA, memberInputB)
  }

  function handleDeleteSelectedMember(){
    if (model.selection?.type !== 'member') return
    if (threeRef.current && typeof threeRef.current.deleteMember === 'function'){
      threeRef.current.deleteMember(model.selection.id)
    }
  }

  function handleUpdateNodeInline(nodeId, axis, value){
    const v = Number(value)
    if (!Number.isFinite(v)) return
    const next = {
      ...model,
      nodes: model.nodes.map((n) => {
        if (n.id !== nodeId) return n
        return {
          ...n,
          position: {
            x: axis === 'x' ? v : n.position.x,
            y: axis === 'y' ? v : n.position.y,
            z: axis === 'z' ? v : n.position.z,
          },
        }
      }),
    }
    applyModel(next)
  }

  function toggleLineDraw(){
    setLineDrawMode((prev) => {
      const next = !prev
      if (!next) setLineStartId(null)
      return next
    })
  }

  function handleAddFloor(){
    applyModel(addFloor(model, { name: floorName || undefined, elevation: Number(floorElev) || 0 }))
    setFloorName('')
  }

  function handleUpdateFloor(id, patch){
    applyModel(updateFloor(model, id, patch))
  }

  function handleRemoveFloor(id){
    const floor = model.floors.find((f) => f.id === id)
    applyModel(removeFloor(model, id))
    if (floor) scheduleUndo({ type: 'floor', floor })
  }

  function getAiscDimsMeters(shape){
    if (!shape || !shape.dims) return { b: 0, h: 0 }
    const rawOD = shape.dims.OD ?? shape.dims.od ?? 0
    const rawB = shape.dims.bf ?? shape.dims.b ?? shape.dims.B ?? rawOD ?? 0
    const rawH = shape.dims.d ?? shape.dims.h ?? shape.dims.Ht ?? shape.dims.H ?? rawOD ?? 0
    const scale = aiscUnits === 'metric' ? 0.001 : 0.0254
    return {
      b: Number(rawB) * scale,
      h: Number(rawH) * scale,
    }
  }

  function handleAddSection(){
    const name = sectionForm.name || `${sectionForm.category} ${model.sections.length + 1}`
    if (sectionForm.material === 'steel') {
      const shape = aiscShapes.find((s) => s.label === sectionForm.steelShape)
      if (!shape) return
      const dims = getAiscDimsMeters(shape)
      applyModel(addSection(model, {
        name,
        category: sectionForm.category,
        material: 'steel',
        shape: 'aisc',
        dims,
        steelType: shape.type,
        steelShape: shape.label,
        aiscUnits,
        aiscDims: shape.dims || {},
      }))
    } else {
      const dims = { b: Number(sectionForm.b) || 0, h: Number(sectionForm.h) || 0 }
      applyModel(addSection(model, {
        name,
        category: sectionForm.category,
        material: 'rc',
        shape: sectionForm.shape,
        dims,
        centroid: sectionForm.centroid,
      }))
    }
    setSectionForm(s => ({ ...s, name: '' }))
  }

  async function handleSaveCustomShape(){
    if (!hasConfig || !db || !firebaseUid) return
    if (sectionForm.material !== 'rc') {
      alert('Custom shapes are for reinforced concrete sections only.')
      return
    }
    if (!isPremium) {
      alert('Custom shapes are a premium feature.')
      return
    }
    const name = sectionForm.name || `${sectionForm.category} ${customShapes.length + 1}`
    const dims = { b: Number(sectionForm.b) || 0, h: Number(sectionForm.h) || 0 }
    await addDoc(collection(db, 'custom_shapes'), {
      uid: firebaseUid,
      name,
      category: sectionForm.category,
      material: sectionForm.material,
      shape: sectionForm.shape,
      dims,
      centroid: sectionForm.centroid,
      units: 'metric',
      createdAt: serverTimestamp(),
    })
    await loadCustomShapes(firebaseUid)
  }

  async function handleCreateUserDoc(){
    if (!db || !firebaseUid) return
    await setDoc(doc(db, 'users', firebaseUid), { premium: true }, { merge: true })
    setIsPremium(true)
  }

  function handleUseCustomShape(){
    const item = customShapes.find((s) => s.id === customShapeId)
    if (!item) return
    setSectionForm({
      name: item.name || '',
      category: item.category || 'beam',
      material: item.material || 'rc',
      shape: item.shape || 'rect',
      b: item.dims?.b || 0.3,
      h: item.dims?.h || 0.5,
      centroid: item.centroid || 'center',
      steelType: item.steelType || 'W',
      steelShape: item.steelShape || '',
    })
    setCustomShapeId('')
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
    if ('sectionId' in patch && patch.sectionId) {
      const customById = Object.fromEntries(customShapes.map((s) => [`custom-${s.id}`, s]))
      const nextSection = customById[patch.sectionId] || model.sections.find((s) => s.id === patch.sectionId)
      if (nextSection?.centroid) normalize.align = nextSection.centroid
      const existing = model.members.find((m) => m.id === memberId)
      if (!('preview' in patch) && !existing?.preview) {
        normalize.preview = 'shape'
      }
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

  function applyDetailingToTargetSection(){
    if (!detailingState || !detailTargetSectionId) return
    applyModel({
      ...model,
      members: model.members.map((m) => (
        m.sectionId === detailTargetSectionId ? { ...m, detailing: detailingState } : m
      )),
    })
  }

  function applyDetailingToSelectedMembers(){
    if (!detailingState || !selectedMemberIds.length) return
    applyModel({
      ...model,
      members: model.members.map((m) => (
        selectedMemberIds.includes(m.id) ? { ...m, detailing: detailingState } : m
      )),
    })
  }

  function updateMultiSelection(nextIds){
    setSelectedMemberIds(nextIds)
    if (threeRef.current && typeof threeRef.current.setMemberSelection === 'function') {
      threeRef.current.setMemberSelection(nextIds)
    }
  }

  function selectMembersBySection(sectionId){
    if (!sectionId) return
    const ids = model.members.filter((m) => m.sectionId === sectionId).map((m) => m.id)
    updateMultiSelection(ids)
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
        : req.type === 'floor'
          ? `Floor ${req.id.slice(0,6)}`
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
    } else if (type === 'floor') {
      const floor = model.floors.find((f) => f.id === id)
      applyModel(removeFloor(model, id))
      if (floor) scheduleUndo({ type:'floor', floor })
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
      } else if (item.type === 'floor'){
        applyModel(addFloor(model, item.floor))
      }
      return rest
    })
  }

  const mergedSections = [
    ...model.sections.map((s) => ({
      ...s,
      material: s.material || 'rc',
      centroid: s.centroid || 'center',
    })),
    ...customShapes.map((s) => ({
      id: `custom-${s.id}`,
      name: s.name,
      category: s.category || 'beam',
      material: s.material || 'rc',
      shape: s.shape || 'rect',
      dims: s.dims || { b: 0.3, h: 0.5 },
      centroid: s.centroid || 'center',
      steelType: s.steelType || null,
      steelShape: s.steelShape || null,
      source: 'custom',
    })),
  ]
  const detailTargetSection = detailTargetSectionId
    ? mergedSections.find((s) => s.id === detailTargetSectionId)
    : null

  const selectedMember = model.selection?.type === 'member'
    ? model.members.find((m) => m.id === model.selection.id)
    : null
  const selectedMemberSection = selectedMember?.sectionId
    ? mergedSections.find((s) => s.id === selectedMember.sectionId)
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
  const aiscTypes = Array.from(new Set(aiscShapes.map((s) => s.type))).filter(Boolean).sort()
  const filteredAiscShapes = sectionForm.steelType
    ? aiscShapes.filter((s) => s.type === sectionForm.steelType)
    : aiscShapes
  const showTree = activeTab === 'modeling' || activeTab === 'detailing'
  const showSectionEditor = activeTab === 'detailing'
  const showScene = activeTab === 'modeling' || activeTab === 'detailing'
  const showBOM = activeTab === 'bom'
  const showModelingPanel = activeTab === 'modeling'
  const showDetailingPanel = activeTab === 'detailing'
  const showSectionsPanel = activeTab === 'sections'

  return (
    <div style={{height: '100vh', display: 'flex', flexDirection: 'column'}}>
      <header style={{padding: 12, background: '#0f172a', color: '#fff', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          <div>OSSM - Open-Source Structural Modeler</div>
          <div style={{fontSize:12, padding:'2px 8px', borderRadius:999, background: isPremium ? '#16a34a' : '#64748b'}}>
            {isPremium ? 'Premium' : 'Free'}
          </div>
        </div>
        <div style={{display:'flex', gap:8}}>
          <button onClick={handleExport} style={{padding:'6px 10px'}}>Export JSON</button>
          <button onClick={handleImportClick} style={{padding:'6px 10px'}}>Import JSON</button>
          <button onClick={handleReset} style={{padding:'6px 10px'}}>Reset Project</button>
          {devUserDocEnabled && (
            <button onClick={handleCreateUserDoc} style={{padding:'6px 10px'}}>Dev: Set Premium</button>
          )}
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
      <div style={{display:'flex', gap:8, padding:'8px 12px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc'}}>
        {[
          { key: 'modeling', label: 'Modeling', icon: FiBox },
          { key: 'detailing', label: 'Detailing', icon: FiEdit3 },
          { key: 'sections', label: 'Sections', icon: FiLayers },
          { key: 'bom', label: 'BOM', icon: FiClipboard },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            title={tab.label}
            style={{
              minWidth:84,
              height:36,
              display:'inline-flex',
              alignItems:'center',
              justifyContent:'center',
              gap:6,
              fontWeight:600,
              background: activeTab === tab.key ? '#0b5fff' : '#e2e8f0',
              color: activeTab === tab.key ? '#fff' : '#111',
              border:'none',
              borderRadius:6,
            }}
          >
            <tab.icon size={16} />
            <span style={{fontSize:12}}>{tab.label}</span>
          </button>
        ))}
      </div>
      <div style={{flex:1, display:'flex', minHeight:0}}>
        {showTree && (
          <TreeSidebar
            open={treeOpen}
            onToggle={() => setTreeOpen(o => !o)}
            nodes={model.nodes}
            members={model.members}
            footings={model.footings}
            floors={model.floors}
            sections={mergedSections}
            onSelect={(sel)=>{
              if (!sel || !threeRef.current) return
              if (sel.type === 'member' && typeof threeRef.current.selectMember === 'function') {
                setPanelOpen(true)
                threeRef.current.selectMember(sel.id)
              } else if (sel.type === 'footing' && typeof threeRef.current.selectFooting === 'function') {
                setPanelOpen(true)
                threeRef.current.selectFooting(sel.id)
              } else if (sel.type === 'node' && typeof threeRef.current.selectNode === 'function') {
                setActiveTab('modeling')
                setPanelOpen(true)
                threeRef.current.selectNode(sel.id)
              }
            }}
            onRequestDelete={(req)=> onRequestDelete(req)}
            onRequestDeleteMember={(id)=> onRequestDelete({ type: 'member', id })}
            onUpdateMember={(id, patch)=> updateMemberMeta(id, patch)}
            selectedDia={dia}
            setSelectedDia={setDia}
            rebarLib={rebarLib}
          />
        )}
        {showSectionEditor && (
          <SectionEditor onSectionChange={setDetailingState} selectedDia={dia} setSelectedDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} addBomLine={addBomLine} />
        )}
        <div style={{flex:1, position:'relative', minHeight:0}}>
          <div
            style={{
              position:'absolute',
              top:0,
              right:0,
              bottom:0,
              width: panelOpen ? 360 : 0,
              transition:'width 200ms ease',
              overflow:'hidden',
              borderLeft:'1px solid #eef2f7',
              background:'#fbfdff',
              zIndex: 2,
            }}
          >
            <div
              style={{
                width:360,
                height:'100%',
                overflow:'auto',
                transform: panelOpen ? 'translateX(0)' : 'translateX(360px)',
                transition:'transform 200ms ease',
                padding:10,
              }}
            >
            {showModelingPanel && (
              <div style={{marginBottom:10}}>
                  <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                    <div style={{fontWeight:600}}>Sketch</div>
                    <button onClick={toggleLineDraw} style={{padding:'6px 10px'}}>
                      {lineDrawMode ? 'Line Draw: On' : 'Line Draw: Off'}
                    </button>
                    <button onClick={toggleRotateMode} style={{padding:'6px 10px'}}>
                      {rotateEnabled ? 'Rotate: On' : 'Rotate: Off'}
                    </button>
                    {lineDrawMode && (
                      <div style={{fontSize:12, color:'#334155'}}>
                        {lineStartId ? `Start: ${lineStartId.slice(0,6)} (pick end node)` : 'Pick start node'}
                      </div>
                    )}
                  </div>
                <div style={{display:'flex', alignItems:'center', gap:8, marginTop:8, flexWrap:'wrap'}}>
                  <label style={{fontSize:12}}>
                    X
                    <input
                      type="number"
                      step="0.1"
                      value={nodeInput.x}
                      onChange={(e)=> setNodeInput(s => ({ ...s, x: e.target.value }))}
                      style={{width:80, marginLeft:6}}
                    />
                    <span style={{marginLeft:4, color:'#94a3b8'}}>m</span>
                  </label>
                  <label style={{fontSize:12}}>
                    Y
                    <input
                      type="number"
                      step="0.1"
                      value={nodeInput.y}
                      onChange={(e)=> setNodeInput(s => ({ ...s, y: e.target.value }))}
                      style={{width:80, marginLeft:6}}
                    />
                    <span style={{marginLeft:4, color:'#94a3b8'}}>m</span>
                  </label>
                  <label style={{fontSize:12}}>
                    Z
                    <input
                      type="number"
                      step="0.1"
                      value={nodeInput.z}
                      onChange={(e)=> setNodeInput(s => ({ ...s, z: e.target.value }))}
                      style={{width:80, marginLeft:6}}
                    />
                    <span style={{marginLeft:4, color:'#94a3b8'}}>m</span>
                  </label>
                  <button onClick={handleAddNodeFromInput} style={{padding:'4px 8px'}}>Add Node</button>
                  <button onClick={handleUpdateSelectedNode} disabled={model.selection?.type !== 'node'} style={{padding:'4px 8px'}}>Update Selected</button>
                  <button onClick={()=> setNodeInput({ x: 0, y: 0, z: 0 })} style={{padding:'4px 8px'}}>Clear</button>
                  <button onClick={handleDeleteSelectedNode} disabled={model.selection?.type !== 'node'} style={{padding:'4px 8px', color:'#b91c1c'}}>Delete Selected</button>
                </div>
              </div>
            )}
            {showModelingPanel && (
                <div style={{display:'flex', alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap'}}>
                  <div style={{fontWeight:600}}>Add Member</div>
                  <div style={{fontSize:12, color:'#94a3b8'}}>Units: m</div>
                  <label style={{fontSize:12}}>
                    Node A
                    <select
                      value={memberInputA}
                      onChange={(e)=> setMemberInputA(e.target.value)}
                      style={{marginLeft:6}}
                    >
                      {model.nodes.map((n, idx) => (
                        <option key={n.id} value={n.id}>
                          Node {idx} ({Number(n.position?.x || 0).toFixed(2)}, {Number(n.position?.y || 0).toFixed(2)}, {Number(n.position?.z || 0).toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Node B
                    <select
                      value={memberInputB}
                      onChange={(e)=> setMemberInputB(e.target.value)}
                      style={{marginLeft:6}}
                    >
                      {model.nodes.map((n, idx) => (
                        <option key={n.id} value={n.id}>
                          Node {idx} ({Number(n.position?.x || 0).toFixed(2)}, {Number(n.position?.y || 0).toFixed(2)}, {Number(n.position?.z || 0).toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </label>
                <button
                  onClick={handleAddMemberFromInput}
                  disabled={!memberInputA || !memberInputB || memberInputA === memberInputB}
                  style={{padding:'6px 10px'}}
                >
                  Add Member
                </button>
                <button
                  onClick={handleDeleteSelectedMember}
                  disabled={model.selection?.type !== 'member'}
                  style={{padding:'6px 10px', color:'#b91c1c'}}
                >
                  Delete Selected
                </button>
              </div>
            )}
            {showDetailingPanel && (
              <>
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
              {selectedMemberIds.length > 0 && (
                <>
                  <div style={{marginTop:8, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                    <div style={{fontSize:12, color:'#475569'}}>
                      Selected members: {selectedMemberIds.length}
                    </div>
                      <button
                        onClick={applyDetailingToSelectedMembers}
                        disabled={!detailingState}
                        style={{padding:'4px 8px'}}
                      >
                        Apply to Selected
                      </button>
                      <button
                        onClick={()=> updateMultiSelection([])}
                        style={{padding:'4px 8px'}}
                      >
                        Clear Selection
                      </button>
                    </div>
                    <div style={{marginTop:6, display:'flex', gap:6, flexWrap:'wrap'}}>
                      {selectedMemberIds.map((id) => (
                        <div key={id} style={{display:'flex', alignItems:'center', gap:6, padding:'2px 6px', border:'1px solid #e2e8f0', borderRadius:6, fontSize:12}}>
                          <div>{id.slice(0,6)}</div>
                          <button
                            onClick={()=> updateMultiSelection(selectedMemberIds.filter((m)=> m !== id))}
                            style={{padding:'0 6px'}}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                  </div>
                </>
              )}
                {detailTargetSection && (
                  <div style={{marginTop:8, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                    <div style={{fontSize:12, color:'#475569'}}>
                      Detail target: {detailTargetSection.name}
                    </div>
                    <button
                      onClick={() => selectMembersBySection(detailTargetSection.id)}
                      style={{padding:'4px 8px'}}
                    >
                      Select Members
                    </button>
                    <button
                      onClick={applyDetailingToTargetSection}
                      disabled={!detailingState}
                      style={{padding:'4px 8px'}}
                    >
                      Apply to Section Members
                    </button>
                    <button
                      onClick={()=> setDetailTargetSectionId(null)}
                      style={{padding:'4px 8px'}}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </>
            )}
            {showModelingPanel && (
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
                Show Grid
                <input
                  type="checkbox"
                  checked={!!model.showGrid}
                  onChange={(e)=> applyModel({ ...model, showGrid: e.target.checked })}
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
            )}
            {showModelingPanel && model.floors && model.floors.length > 0 && (
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
                    <button onClick={()=> handleRemoveFloor(f.id)} style={{color:'#b91c1c'}}>Delete</button>
                  </div>
                ))}
              </div>
            )}
            {showSectionsPanel && (
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Section Properties</div>
              <label style={{fontSize:12}}>
                Category
                <select
                  value={sectionForm.category}
                  onChange={(e)=> {
                    const category = e.target.value
                    const forceRc = category === 'pedestal' || category === 'footing'
                    setSectionForm(s => ({
                      ...s,
                      category,
                      material: forceRc ? 'rc' : s.material,
                      shape: forceRc ? 'rect' : s.shape,
                    }))
                  }}
                  style={{marginLeft:6}}
                >
                  <option value="beam">Beam</option>
                  <option value="column">Column</option>
                  <option value="pedestal">Pedestal</option>
                  <option value="footing">Footing</option>
                </select>
              </label>
              <label style={{fontSize:12}}>
                Material
                <select
                  value={sectionForm.material}
                  onChange={(e)=> {
                    const material = e.target.value
                    const firstSteel = material === 'steel'
                      ? aiscShapes.find((s) => s.type === sectionForm.steelType)?.label || ''
                      : ''
                    setSectionForm(s => ({
                      ...s,
                      material,
                      shape: material === 'steel' ? 'aisc' : 'rect',
                      steelShape: material === 'steel' ? (s.steelShape || firstSteel) : '',
                    }))
                  }}
                  style={{marginLeft:6}}
                >
                  <option value="rc">Reinforced Concrete</option>
                  <option value="steel" disabled={sectionForm.category === 'pedestal' || sectionForm.category === 'footing'}>Steel</option>
                </select>
              </label>
              {sectionForm.material === 'steel' && aiscShapes.length === 0 && (
                <div style={{fontSize:12, color:'#b45309'}}>
                  No AISC data loaded. Start backend on `http://localhost:4000`.
                </div>
              )}
              <label style={{fontSize:12}}>
                Units
                <select
                  value={aiscUnits}
                  onChange={(e)=> setAiscUnits(e.target.value)}
                  style={{marginLeft:6}}
                >
                  <option value="metric">Metric</option>
                  <option value="imperial">Imperial</option>
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
              {sectionForm.material === 'rc' ? (
                <>
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
                  <label style={{fontSize:12}}>
                    Centroid
                    <select
                      value={sectionForm.centroid}
                      onChange={(e)=> setSectionForm(s => ({ ...s, centroid: e.target.value }))}
                      style={{marginLeft:6}}
                    >
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                    </select>
                  </label>
                  <button
                    onClick={() => {
                      setActiveTab('detailing')
                      setPanelOpen(true)
                    }}
                    style={{padding:'6px 10px'}}
                  >
                    Detail
                  </button>
                </>
              ) : (
                <>
                  <label style={{fontSize:12}}>
                    Steel Type
                    <select
                      value={sectionForm.steelType}
                      onChange={(e)=> {
                        const steelType = e.target.value
                        const firstShape = aiscShapes.find((s) => s.type === steelType)?.label || ''
                        setSectionForm(s => ({ ...s, steelType, steelShape: firstShape }))
                      }}
                      style={{marginLeft:6}}
                    >
                      {aiscTypes.length === 0 && <option value="">None</option>}
                      {aiscTypes.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Steel Section
                    <select
                      value={sectionForm.steelShape}
                      onChange={(e)=> setSectionForm(s => ({ ...s, steelShape: e.target.value }))}
                      style={{marginLeft:6, minWidth:160}}
                    >
                      <option value="">Select</option>
                      {filteredAiscShapes.map((s) => (
                        <option key={s.label} value={s.label}>{s.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <button
                onClick={handleAddSection}
                disabled={sectionForm.material === 'steel' && !sectionForm.steelShape}
                style={{padding:'6px 10px'}}
              >
                Add Section
              </button>
              {sectionForm.material === 'rc' && (
                <>
                  <button onClick={handleSaveCustomShape} disabled={!hasConfig || !firebaseUid} style={{padding:'6px 10px'}}>
                    Save Custom Shape
                  </button>
                  {!isPremium && (
                    <div style={{fontSize:12, color:'#b45309'}}>
                      Custom shapes are premium.
                    </div>
                  )}
                </>
              )}
            </div>
            )}
            {showSectionsPanel && customShapes.length > 0 && (
              <div style={{display:'flex', alignItems:'center', gap:10, marginTop:8, flexWrap:'wrap'}}>
                <div style={{fontSize:12, color:'#475569'}}>Custom Shapes</div>
                <select
                  value={customShapeId}
                  onChange={(e)=> setCustomShapeId(e.target.value)}
                  style={{minWidth:180}}
                >
                  <option value="">Select shape</option>
                  {customShapes.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button onClick={handleUseCustomShape} disabled={!customShapeId}>
                  Load
                </button>
              </div>
            )}
            {showSectionsPanel && mergedSections && mergedSections.length > 0 && (
              <div style={{marginTop:8}}>
                {mergedSections.map((s) => (
                  <div key={s.id} style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                    <div style={{minWidth:110, fontSize:12}}>{s.category}</div>
                    <div style={{flex:1, fontSize:12}}>
                      {s.name}
                      {s.material === 'steel' && s.steelShape ? ` (${s.steelShape})` : ''}
                    </div>
                    <button
                      onClick={() => {
                        setDetailTargetSectionId(s.id)
                        setActiveTab('detailing')
                        setPanelOpen(true)
                      }}
                      style={{padding:'2px 6px'}}
                    >
                      Detail
                    </button>
                    {s.source === 'custom' ? (
                      <div style={{fontSize:12, color:'#64748b'}}>Custom</div>
                    ) : (
                      <button onClick={()=> handleRemoveSection(s.id)}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {showSectionsPanel && (
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
            )}
            {(showModelingPanel || showDetailingPanel || showSectionsPanel) && (
              <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
                <div style={{fontWeight:600}}>Selection</div>
                <div style={{fontSize:12}}>
                  {model.selection?.type ? `${model.selection.type} ${model.selection.id?.slice(0,6)}` : 'None'}
                </div>
                {model.selection?.type && (
                  <button
                    onClick={clearSelection}
                    style={{padding:'4px 8px'}}
                  >
                    Unselect
                  </button>
                )}
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
                      {mergedSections.filter(s => s.category === (model.members.find(m => m.id === model.selection.id)?.type || 'beam')).map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.material === 'steel' && s.steelShape ? ` (${s.steelShape})` : ''}
                          {s.source === 'custom' ? ' (Custom)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Preview
                    <select
                      value={(model.members.find(m => m.id === model.selection.id)?.preview) || 'shape'}
                      onChange={(e)=> updateMemberMeta(model.selection.id, { preview: e.target.value })}
                      style={{marginLeft:6}}
                    >
                      <option value="shape">Shape</option>
                      <option value="line">Line</option>
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
                      {mergedSections.filter(s => s.category === 'footing').map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.source === 'custom' ? ' (Custom)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
            {showModelingPanel && (
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
            )}
            {showModelingPanel && (
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
            )}
            </div>
          </div>
          {showScene && (
            <div style={{position:'absolute', inset:0}}>
              <ThreeScene
                ref={threeRef}
                model={model}
                sections={mergedSections}
                initialModel={initialModelRef.current}
                floors={model.floors}
                nglElevation={model.ngl}
                showGrid={!!model.showGrid}
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
          )}
        </div>
        {showBOM && (
          <BOMPanel dia={dia} setDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} bomLines={bomLines} setBomLines={setBomLines} />
        )}
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
