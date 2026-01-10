import React, { useState, useRef, useEffect } from 'react'
import * as THREE from 'three'
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
    centroid: 'center',
    b: 0.3,
    h: 0.5,
    l: 0.3,
    steelType: 'W',
    steelShape: '',
  })
  const [detailingState, setDetailingState] = useState(null)
  const [detailTargetSectionId, setDetailTargetSectionId] = useState('')
  const [validationReport, setValidationReport] = useState(null)
  const [dupOffset, setDupOffset] = useState({ x: 1, y: 0, z: 0 })
  const [treeOpen, setTreeOpen] = useState(true)
  const [activeTab, setActiveTab] = useState('modeling')
  const [viewMode, setViewMode] = useState('geometry')
  const [rotateEnabled, setRotateEnabled] = useState(false)
  const [nodeInput, setNodeInput] = useState({ x: 0, y: 0, z: 0 })
  const [lineDrawMode, setLineDrawMode] = useState(false)
  const [multiSelectMode, setMultiSelectMode] = useState('none') // 'none' | 'nodes' | 'members'
  const [lineStartId, setLineStartId] = useState(null)
  const [memberForm, setMemberForm] = useState({ a: '', b: '' })
  const [extrudeForm, setExtrudeForm] = useState({ sectionId: '', dx: 0, dy: 0, dz: 0, count: 1 })
  const [memberSectionChoice, setMemberSectionChoice] = useState('')
  const [multiNodeIds, setMultiNodeIds] = useState([])
  const [betaModalOpen, setBetaModalOpen] = useState(false)
  const [betaValue, setBetaValue] = useState('0')
  const [editSectionOpen, setEditSectionOpen] = useState(false)
  const [editSectionForm, setEditSectionForm] = useState(null)
  const [editAiscUnits, setEditAiscUnits] = useState('metric')
  const [editAiscType, setEditAiscType] = useState('W')
  const [editAiscShapes, setEditAiscShapes] = useState([])
  const [editAiscLoading, setEditAiscLoading] = useState(false)
  const [editAiscError, setEditAiscError] = useState('')
  const [panelOpen, setPanelOpen] = useState({
    nodes: true,
    member: false,
    footing: false,
    levels: false,
    constraints: false,
    duplicate: false,
    extrude: false,
    multi: false,
  })
  const [footingSectionId, setFootingSectionId] = useState('')
  const [aiscUnits, setAiscUnits] = useState('metric')
  const [aiscType, setAiscType] = useState('W')
  const [aiscShapes, setAiscShapes] = useState([])
  const [aiscLoading, setAiscLoading] = useState(false)
  const [aiscError, setAiscError] = useState('')
  const [firebaseUid, setFirebaseUid] = useState(null)
  const [isPremium, setIsPremium] = useState(false)
  const [customShapes, setCustomShapes] = useState([])
  const [customShapeId, setCustomShapeId] = useState('')
  const devUserDocEnabled = import.meta.env.VITE_DEV_USER_DOC === '1'

  function addBomLine(line){
    const withId = { id: Date.now() + Math.random(), ...line }
    setBomLines(s => [withId, ...s])
  }

  const threeRef = useRef(null)
  const importRef = useRef(null)
  const pendingMemberMetaRef = useRef({})
  const memberMetaRef = useRef({})
  const pendingFootingMetaRef = useRef({})
  const lastSelectedMemberIdRef = useRef(null)
  const lastSelectedNodeIdRef = useRef(null)
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
      const metaCache = memberMetaRef.current || {}
      const members = (payload.members || []).map((mem) => {
        const prev = existingMembers[mem.id]
        const pendingMeta = pending[mem.id]
        const cachedMeta = metaCache[mem.id]
        if (pendingMeta) delete pending[mem.id]
        const type = pendingMeta?.type ?? cachedMeta?.type ?? prev?.type ?? 'beam'
        const align = pendingMeta?.align ?? cachedMeta?.align ?? prev?.align ?? (type === 'beam' ? 'top' : 'center')
        const sectionId = pendingMeta?.sectionId ?? cachedMeta?.sectionId ?? prev?.sectionId ?? null
        const beta = Number(pendingMeta?.beta ?? cachedMeta?.beta ?? prev?.beta) || 0
        const rotation = pendingMeta?.rotation ?? cachedMeta?.rotation ?? prev?.rotation ?? { x: 0, y: 0, z: 0 }
        const preview = pendingMeta?.preview ?? cachedMeta?.preview ?? prev?.preview ?? 'shape'
        const detailing = pendingMeta?.detailing ?? cachedMeta?.detailing ?? prev?.detailing ?? null
        const nextMember = {
          ...(prev || {}),
          ...mem,
          type,
          align,
          sectionId,
          beta,
          rotation,
          preview,
          detailing,
        }
        metaCache[mem.id] = {
          type,
          align,
          sectionId,
          beta,
          rotation,
          preview,
          detailing,
        }
        return nextMember
      })
      const pendingFootings = pendingFootingMetaRef.current || {}
      const footings = (payload.footings || []).map((f) => {
        const prev = existingFootings[f.id]
        const pendingFooting = pendingFootings[f.id]
        if (pendingFooting) delete pendingFootings[f.id]
        return {
          ...f,
          sectionId: pendingFooting?.sectionId || prev?.sectionId || null,
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
    if (selection?.type === 'node' && Array.isArray(selection.multiNodes)) {
      setMultiNodeIds(selection.multiNodes)
      lastSelectedNodeIdRef.current = selection.id
    } else if (!selection || selection.type !== 'node') {
      setMultiNodeIds([])
    } else if (selection?.type === 'node') {
      lastSelectedNodeIdRef.current = selection.id
    }
    if (!selection || selection.type !== 'node' || !lineDrawMode) return
    if (!lineStartId) {
      setLineStartId(selection.id)
      return
    }
    if (lineStartId === selection.id) return
    setLineStartId(null)
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

  useEffect(() => {
    if (threeRef.current && typeof threeRef.current.setRotateMode === 'function') {
      threeRef.current.setRotateMode(rotateEnabled)
    }
  }, [rotateEnabled])

  useEffect(() => {
    if (sectionForm.material !== 'steel') return
    let cancelled = false
    setAiscLoading(true)
    setAiscError('')
    fetch(`http://localhost:4000/api/aisc?units=${encodeURIComponent(aiscUnits)}&type=${encodeURIComponent(aiscType)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('aisc fetch failed'))))
      .then((data) => {
        if (cancelled) return
        setAiscShapes(Array.isArray(data.shapes) ? data.shapes : [])
      })
      .catch(() => {
        if (cancelled) return
        setAiscShapes([])
        setAiscError('AISC data unavailable. Start backend on http://localhost:4000.')
      })
      .finally(() => {
        if (!cancelled) setAiscLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sectionForm.material, aiscUnits, aiscType])

  useEffect(() => {
    if (sectionForm.material === 'steel' && sectionForm.category === 'pedestal') {
      setSectionForm((s) => ({ ...s, category: 'column' }))
    }
    if (sectionForm.material === 'steel' && sectionForm.category === 'footing') {
      setSectionForm((s) => ({ ...s, category: 'beam' }))
    }
  }, [sectionForm.material, sectionForm.category])

  useEffect(() => {
    if (!editSectionOpen || editSectionForm?.material !== 'steel') return
    let cancelled = false
    setEditAiscLoading(true)
    setEditAiscError('')
    fetch(`http://localhost:4000/api/aisc?units=${encodeURIComponent(editAiscUnits)}&type=${encodeURIComponent(editAiscType)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('aisc fetch failed'))))
      .then((data) => {
        if (cancelled) return
        setEditAiscShapes(Array.isArray(data?.shapes) ? data.shapes : [])
      })
      .catch(() => {
        if (cancelled) return
        setEditAiscError('Failed to load AISC list.')
        setEditAiscShapes([])
      })
      .finally(() => {
        if (!cancelled) setEditAiscLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [editSectionOpen, editSectionForm?.material, editAiscUnits, editAiscType])

  useEffect(() => {
    if (detailTargetSectionId) return
    const firstRc = model.sections.find((s) => s.material !== 'steel')
    if (firstRc) setDetailTargetSectionId(firstRc.id)
  }, [model.sections, detailTargetSectionId])


  useEffect(() => {
    if (activeTab !== 'modeling' && rotateEnabled) {
      setRotateEnabled(false)
    }
  }, [activeTab, rotateEnabled])

  useEffect(() => {
    if (model.selection?.type === 'member') {
      const memberId = model.selection.id
      if (memberId && lastSelectedMemberIdRef.current !== memberId) {
        const member = model.members.find((m) => m.id === memberId)
        setMemberSectionChoice(member?.sectionId || '')
        lastSelectedMemberIdRef.current = memberId
      }
    }
  }, [model.selection?.id])

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

  function assignFootingSectionToSelected(){
    if (!model.selection || model.selection.type !== 'node') return
    const section = mergedSections.find((s) => s.id === footingSectionId)
    if (!section) return
    const dims = section.dims || {}
    const size = {
      x: Number(dims.b) || footingSize.x,
      y: Number(dims.h) || footingSize.y,
      z: Number(dims.l) || Number(dims.b) || footingSize.z,
    }
    if (!threeRef.current || typeof threeRef.current.addFooting !== 'function') return
    const footingId = threeRef.current.addFooting(model.selection.id, size)
    if (footingId) {
      pendingFootingMetaRef.current[footingId] = { sectionId: section.id }
    }
  }

  function clearSelection(){
    if (threeRef.current && typeof threeRef.current.clearSelection === 'function') {
      threeRef.current.clearSelection()
    } else {
      setModel(m => setSelection(m, { type: null, id: null }))
    }
    setLineStartId(null)
    setMultiNodeIds([])
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
    const eps = 1e-6
    const exists = model.nodes.some((n) => {
      const pos = n.position || {}
      return Math.abs((pos.x || 0) - x) < eps &&
        Math.abs((pos.y || 0) - y) < eps &&
        Math.abs((pos.z || 0) - z) < eps
    })
    if (exists) {
      alert('A node already exists at these coordinates.')
      return
    }
    threeRef.current.addNode(new THREE.Vector3(x, y, z))
  }

  function handleSetMultiSelectMode(next){
    setMultiSelectMode((prev) => {
      const value = prev === next ? 'none' : next
      if (threeRef.current && typeof threeRef.current.clearSelection === 'function') {
        threeRef.current.clearSelection()
      }
      setMultiNodeIds([])
      if (value === 'nodes' || value === 'members') {
        setLineDrawMode(false)
        setLineStartId(null)
      }
      return value
    })
  }

  function handleAddMemberFromForm(){
    if (!threeRef.current || typeof threeRef.current.addMember !== 'function') return
    if (!memberForm.a || !memberForm.b || memberForm.a === memberForm.b) return
    threeRef.current.addMember(memberForm.a, memberForm.b)
    setMemberForm({ a: '', b: '' })
  }

  function createMemberWithMeta(aId, bId, meta){
    if (!threeRef.current || typeof threeRef.current.addMember !== 'function') return null
    const forcedId = THREE.MathUtils.generateUUID()
    pendingMemberMetaRef.current[forcedId] = meta
    memberMetaRef.current[forcedId] = meta
    const newId = threeRef.current.addMember(aId, bId, forcedId)
    if (!newId) {
      delete pendingMemberMetaRef.current[forcedId]
      delete memberMetaRef.current[forcedId]
    } else if (newId !== forcedId) {
      pendingMemberMetaRef.current[newId] = pendingMemberMetaRef.current[forcedId]
      delete pendingMemberMetaRef.current[forcedId]
      memberMetaRef.current[newId] = memberMetaRef.current[forcedId]
      delete memberMetaRef.current[forcedId]
    }
    if (newId) {
      setModel((prev) => {
        if (prev.members.some((m) => m.id === newId)) return prev
        const nextMember = {
          id: newId,
          a: aId,
          b: bId,
          type: meta?.type || 'beam',
          align: meta?.align || 'center',
          sectionId: meta?.sectionId || null,
          beta: Number(meta?.beta) || 0,
          rotation: meta?.rotation || { x: 0, y: 0, z: 0 },
          preview: meta?.preview || 'shape',
          detailing: meta?.detailing || null,
        }
        return { ...prev, members: [...prev.members, nextMember] }
      })
    }
    return newId
  }

  function handleExtrude(){
    const baseNodeId = model.selection?.type === 'node'
      ? model.selection.id
      : lastSelectedNodeIdRef.current
    const targetNodeIds = multiSelectMode === 'nodes' && multiNodeIds.length
      ? multiNodeIds
      : baseNodeId ? [baseNodeId] : []
    if (!targetNodeIds.length) return
    if (!threeRef.current || typeof threeRef.current.addNode !== 'function' || typeof threeRef.current.addMember !== 'function') return
    const section = mergedSections.find((s) => s.id === extrudeForm.sectionId)
    if (!section) return
    const sceneNodes = typeof threeRef.current.getNodes === 'function' ? threeRef.current.getNodes() : []
    const dx = Number(extrudeForm.dx) || 0
    const dy = Number(extrudeForm.dy) || 0
    const dz = Number(extrudeForm.dz) || 0
    const count = Math.max(1, Number(extrudeForm.count) || 1)
    const meta = {
      type: section.category || 'beam',
      sectionId: section.id,
      align: section.centroid === 'top' ? 'top' : 'center',
      rotation: { x: 0, y: 0, z: 0 },
      preview: 'shape',
    }
    targetNodeIds.forEach((nodeId) => {
      const baseNode = model.nodes.find((n) => n.id === nodeId)
      const baseSceneNode = sceneNodes.find((n) => n.id === nodeId)
      const basePos = baseNode?.position || baseSceneNode?.position
      if (!basePos) return
      let prevId = nodeId
      let prevPos = new THREE.Vector3(basePos.x, basePos.y, basePos.z)
      for (let i = 0; i < count; i++) {
        const nextPos = new THREE.Vector3(
          prevPos.x + dx,
          prevPos.y + dy,
          prevPos.z + dz
        )
        const newNodeId = threeRef.current.addNode(nextPos)
        if (!newNodeId) break
        createMemberWithMeta(prevId, newNodeId, meta)
        prevId = newNodeId
        prevPos = nextPos
      }
    })
  }

  function toggleLineDraw(){
    setLineDrawMode((prev) => {
      const next = !prev
      if (!next) setLineStartId(null)
      if (next) {
        setMultiSelectMode('none')
      }
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
    applyModel(removeFloor(model, id))
  }

  function handleAddSection(){
    const name = sectionForm.name || `${sectionForm.category} ${model.sections.length + 1}`
    if (sectionForm.material === 'steel') {
      const parseNumber = (value) => {
        const s = String(value ?? '').trim()
        if (!s) return NaN
        const mixed = s.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/)
        if (mixed) {
          const whole = Number(mixed[1])
          const num = Number(mixed[2])
          const den = Number(mixed[3])
          if (den) return whole + num / den
        }
        const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/)
        if (frac) {
          const num = Number(frac[1])
          const den = Number(frac[2])
          if (den) return num / den
        }
        const num = Number(s)
        return Number.isFinite(num) ? num : NaN
      }
      const shape = aiscShapes.find((s) => s.label === sectionForm.steelShape || s.std === sectionForm.steelShape)
      if (!shape || !shape.dims) return
      const scale = aiscUnits === 'metric' ? 0.001 : 0.0254
      const bRaw = parseNumber(shape.dims.bf ?? shape.dims.b ?? shape.dims.B)
      const hRaw = parseNumber(shape.dims.d ?? shape.dims.Ht ?? shape.dims.h)
      const dims = {
        b: Number.isFinite(bRaw) ? bRaw * scale : 0,
        h: Number.isFinite(hRaw) ? hRaw * scale : 0,
      }
      applyModel(addSection(model, {
        name: name || shape.label || 'Steel Section',
        category: sectionForm.category,
        material: 'steel',
        shape: 'aisc',
        dims,
        steelType: aiscType,
        steelShape: shape.label || sectionForm.steelShape,
        aiscUnits,
        aiscDims: shape.dims,
      }))
      setSectionForm(s => ({ ...s, name: '' }))
      return
    }
    const lVal = Number(sectionForm.l) || Number(sectionForm.b) || 0
    const dims = { b: Number(sectionForm.b) || 0, h: Number(sectionForm.h) || 0, l: lVal }
    applyModel(addSection(model, {
      name,
      category: sectionForm.category,
      material: 'rc',
      shape: sectionForm.shape,
      centroid: sectionForm.centroid,
      dims,
    }))
    setSectionForm(s => ({ ...s, name: '' }))
  }

  async function handleSaveCustomShape(){
    if (!hasConfig || !db || !firebaseUid) return
    if (!isPremium) {
      alert('Custom shapes are a premium feature.')
      return
    }
    if (sectionForm.material === 'steel') {
      alert('Custom steel shapes are not supported yet.')
      return
    }
    const name = sectionForm.name || `${sectionForm.category} ${customShapes.length + 1}`
    const dims = { b: Number(sectionForm.b) || 0, h: Number(sectionForm.h) || 0, l: Number(sectionForm.l) || 0 }
    await addDoc(collection(db, 'custom_shapes'), {
      uid: firebaseUid,
      name,
      category: sectionForm.category,
      shape: sectionForm.shape,
      dims,
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
      material: 'rc',
      shape: item.shape || 'rect',
      centroid: 'center',
      b: item.dims?.b || 0.3,
      h: item.dims?.h || 0.5,
      l: item.dims?.l || item.dims?.b || 0.3,
      steelType: 'W',
      steelShape: '',
    })
    setCustomShapeId('')
  }

  function handleRemoveSection(id){
    applyModel(removeSection(model, id))
  }

  function openEditSection(section){
    if (!section) return
    setEditSectionForm({
      id: section.id,
      name: section.name || '',
      category: section.category || 'beam',
      material: section.material || 'rc',
      centroid: section.centroid || 'center',
      b: section.dims?.b ?? 0.3,
      h: section.dims?.h ?? 0.5,
      l: section.dims?.l ?? section.dims?.b ?? 0.3,
      steelType: section.steelType || 'W',
      steelShape: section.steelShape || '',
      aiscUnits: section.aiscUnits || 'metric',
    })
    setEditAiscUnits(section.aiscUnits || 'metric')
    setEditAiscType(section.steelType || 'W')
    setEditSectionOpen(true)
  }

  function applySectionEdit(){
    if (!editSectionForm?.id) {
      setEditSectionOpen(false)
      return
    }
    const parseNumber = (value) => {
      const s = String(value ?? '').trim()
      if (!s) return NaN
      const mixed = s.match(/^(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)$/)
      if (mixed) {
        const whole = Number(mixed[1])
        const num = Number(mixed[2])
        const den = Number(mixed[3])
        if (den) return whole + num / den
      }
      const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/)
      if (frac) {
        const num = Number(frac[1])
        const den = Number(frac[2])
        if (den) return num / den
      }
      const num = Number(s)
      return Number.isFinite(num) ? num : NaN
    }
    const patch = {
      name: editSectionForm.name || 'Section',
      category: editSectionForm.category || 'beam',
    }
    if (editSectionForm.material === 'steel') {
      const shape = editAiscShapes.find((s) => s.label === editSectionForm.steelShape || s.std === editSectionForm.steelShape)
      if (!shape || !shape.dims) {
        setEditSectionOpen(false)
        return
      }
      const scale = editAiscUnits === 'metric' ? 0.001 : 0.0254
      const bRaw = parseNumber(shape.dims.bf ?? shape.dims.b ?? shape.dims.B)
      const hRaw = parseNumber(shape.dims.d ?? shape.dims.Ht ?? shape.dims.h)
      patch.material = 'steel'
      patch.aiscUnits = editAiscUnits
      patch.steelType = editAiscType
      patch.steelShape = shape.label || editSectionForm.steelShape
      patch.aiscDims = shape.dims
      patch.dims = {
        b: Number.isFinite(bRaw) ? bRaw * scale : 0,
        h: Number.isFinite(hRaw) ? hRaw * scale : 0,
      }
    } else {
      patch.material = 'rc'
      patch.centroid = editSectionForm.centroid || 'center'
      patch.dims = {
        b: Number(editSectionForm.b) || 0,
        h: Number(editSectionForm.h) || 0,
        l: Number(editSectionForm.l) || Number(editSectionForm.b) || 0,
      }
    }
    applyModel(updateSection(model, editSectionForm.id, patch))
    setEditSectionOpen(false)
  }

  function updateMemberMeta(memberId, patch){
    const normalize = { ...patch }
    if ('sectionId' in patch && !patch.sectionId) {
      normalize.sectionId = null
      normalize.align = 'center'
    }
    if ('sectionId' in patch && patch.sectionId && !('preview' in patch)) {
      normalize.preview = 'shape'
    }
    const existing = model.members.find((m) => m.id === memberId) || {}
    const nextMeta = {
      type: normalize.type ?? existing.type ?? 'beam',
      align: normalize.align ?? existing.align ?? 'center',
      sectionId: normalize.sectionId ?? existing.sectionId ?? null,
      beta: Number.isFinite(normalize.beta)
        ? normalize.beta
        : (Number(existing.beta) || 0),
      rotation: normalize.rotation ?? existing.rotation ?? { x: 0, y: 0, z: 0 },
      detailing: normalize.detailing ?? existing.detailing ?? null,
      preview: normalize.preview ?? existing.preview ?? 'shape',
    }
    pendingMemberMetaRef.current[memberId] = nextMeta
    memberMetaRef.current[memberId] = nextMeta
    setModel((prev) => {
      const next = {
        ...prev,
        members: prev.members.map((m) => (m.id === memberId ? { ...m, ...normalize } : m)),
      }
      if (threeRef.current && typeof threeRef.current.setModel === 'function') {
        threeRef.current.setModel(next)
      }
      return next
    })
  }

  function assignSectionToSelectedMember(){
    const memberId = model.selection?.type === 'member'
      ? model.selection.id
      : lastSelectedMemberIdRef.current
    if (!memberId) return
    updateMemberMeta(memberId, { sectionId: memberSectionChoice || null, preview: memberSectionChoice ? 'shape' : undefined })
  }


  function applyDetailingToSection(){
    if (!detailingState || !detailTargetSectionId) return
    const target = model.sections.find((s) => s.id === detailTargetSectionId)
    if (!target || target.material === 'steel') return
    applyModel({
      ...model,
      sections: model.sections.map((s) => (s.id === detailTargetSectionId ? { ...s, detailing: detailingState } : s)),
      members: model.members.map((m) => (
        m.sectionId === detailTargetSectionId ? { ...m, detailing: detailingState } : m
      )),
      footings: model.footings.map((f) => (
        f.sectionId === detailTargetSectionId ? { ...f, detailing: detailingState } : f
      )),
    })
  }

  function validateDetailing(){
    const missingSections = model.sections.filter((s) => s.material !== 'steel' && !s.detailing)
    const missingMembers = model.members.filter((m) => {
      const section = model.sections.find((s) => s.id === m.sectionId)
      if (!section || section.material === 'steel') return false
      return !m.detailing
    })
    const missingFootings = model.footings.filter((f) => {
      const section = model.sections.find((s) => s.id === f.sectionId)
      if (!section || section.material === 'steel') return false
      return !f.detailing
    })
    setValidationReport({
      missingSections,
      missingMembers,
      missingFootings,
    })
  }

  function updateFootingMeta(footingId, patch){
    applyModel({
      ...model,
      footings: model.footings.map((f) => (f.id === footingId ? { ...f, ...patch } : f)),
    })
  }

  function updateFootingSection(footingId, sectionId){
    const section = mergedSections.find((s) => s.id === sectionId)
    const size = section?.dims
      ? {
          x: Number(section.dims.b) || 0,
          y: Number(section.dims.h) || 0,
          z: Number(section.dims.l || section.dims.b) || 0,
        }
      : null
    updateFootingMeta(footingId, {
      sectionId: sectionId || null,
      ...(size ? { size } : {}),
    })
  }

  function duplicateNode(){
    if (model.selection?.type !== 'node') return
    const node = model.nodes.find((n) => n.id === model.selection.id)
    if (!node) return
    const pos = node.position
    const offset = {
      x: Number(dupOffset.x) || 0,
      y: Number(dupOffset.y) || 0,
      z: Number(dupOffset.z) || 0,
    }
    const nextPos = new THREE.Vector3(
      (pos?.x || 0) + offset.x,
      (pos?.y || 0) + offset.y,
      (pos?.z || 0) + offset.z
    )
    const eps = 1e-6
    const existing = model.nodes.find((n) => {
      const p = n.position || {}
      return Math.abs((p.x || 0) - nextPos.x) < eps &&
        Math.abs((p.y || 0) - nextPos.y) < eps &&
        Math.abs((p.z || 0) - nextPos.z) < eps
    })
    if (existing) {
      if (threeRef.current && typeof threeRef.current.selectNode === 'function') {
        threeRef.current.selectNode(existing.id)
      }
      return
    }
    if (threeRef.current && typeof threeRef.current.addNode === 'function'){
      threeRef.current.addNode(nextPos)
    }
  }

  function openBetaModal(){
    if (model.selection?.type !== 'member') return
    const member = model.members.find((m) => m.id === model.selection.id)
    const beta = Number(member?.beta) || 0
    setBetaValue(String(beta))
    setBetaModalOpen(true)
  }

  function applyBetaAngle(){
    if (model.selection?.type !== 'member') {
      setBetaModalOpen(false)
      return
    }
    const beta = Number(betaValue)
    updateMemberMeta(model.selection.id, { beta: Number.isFinite(beta) ? beta : 0 })
    setBetaModalOpen(false)
  }

  function duplicateMember(){
    if (model.selection?.type !== 'member') return
    const member = model.members.find((m) => m.id === model.selection.id)
    if (!member) return
    const a = model.nodes.find((n) => n.id === member.a)
    const b = model.nodes.find((n) => n.id === member.b)
    if (!a || !b) return
    const offset = {
      x: Number(dupOffset.x) || 0,
      y: Number(dupOffset.y) || 0,
      z: Number(dupOffset.z) || 0,
    }
    const aPos = a.position || { x: 0, y: 0, z: 0 }
    const bPos = b.position || { x: 0, y: 0, z: 0 }
    const newA = new THREE.Vector3(aPos.x + offset.x, aPos.y + offset.y, aPos.z + offset.z)
    const newB = new THREE.Vector3(bPos.x + offset.x, bPos.y + offset.y, bPos.z + offset.z)
    if (!threeRef.current || typeof threeRef.current.addNode !== 'function' || typeof threeRef.current.addMember !== 'function') return
    const eps = 1e-6
    const existingA = model.nodes.find((n) => {
      const p = n.position || {}
      return Math.abs((p.x || 0) - newA.x) < eps &&
        Math.abs((p.y || 0) - newA.y) < eps &&
        Math.abs((p.z || 0) - newA.z) < eps
    })
    const existingB = model.nodes.find((n) => {
      const p = n.position || {}
      return Math.abs((p.x || 0) - newB.x) < eps &&
        Math.abs((p.y || 0) - newB.y) < eps &&
        Math.abs((p.z || 0) - newB.z) < eps
    })
    const aId = existingA?.id || threeRef.current.addNode(newA)
    const bId = existingB?.id || threeRef.current.addNode(newB)
    if (!aId || !bId) return
    createMemberWithMeta(aId, bId, {
      type: member.type || 'beam',
      sectionId: member.sectionId || null,
      align: member.align || 'center',
      rotation: member.rotation || { x: 0, y: 0, z: 0 },
      preview: member.preview || 'shape',
      detailing: member.detailing || null,
    })
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
      preview: member.preview || 'shape',
      detailing: member.detailing || null,
    }
    createMemberWithMeta(member.a, midId, meta)
    createMemberWithMeta(midId, member.b, meta)
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
      preview: member.preview || 'shape',
      detailing: member.detailing || null,
    }
    createMemberWithMeta(member.a, nodeId, meta)
    createMemberWithMeta(nodeId, member.b, meta)
    if (typeof threeRef.current.deleteMember === 'function') {
      threeRef.current.deleteMember(member.id)
    }
    const other = pick.other
    const otherMeta = {
      type: other.type || 'beam',
      sectionId: other.sectionId || null,
      align: other.align || 'center',
      rotation: other.rotation || { x: 0, y: 0, z: 0 },
      preview: other.preview || 'shape',
      detailing: other.detailing || null,
    }
    createMemberWithMeta(other.a, nodeId, otherMeta)
    createMemberWithMeta(nodeId, other.b, otherMeta)
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
    createMemberWithMeta(a1, b1, {
      type: member.type || 'beam',
      sectionId: member.sectionId || null,
      align: member.align || 'center',
      rotation: member.rotation || { x: 0, y: 0, z: 0 },
      preview: member.preview || 'shape',
      detailing: member.detailing || null,
    })
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
        preview: member.preview || 'shape',
        detailing: member.detailing || null,
      }
      for (let i = 0; i < chain.length - 1; i++){
        createMemberWithMeta(chain[i], chain[i + 1], meta)
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
      handleRemoveFloor(id)
    }
    if (model.selection?.id === id && model.selection?.type === type) {
      clearSelection()
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

  const mergedSections = [
    ...model.sections,
    ...customShapes.map((s) => ({
      id: `custom-${s.id}`,
      name: s.name,
      category: s.category || 'beam',
      material: 'rc',
      shape: s.shape || 'rect',
      dims: s.dims || { b: 0.3, h: 0.5 },
      source: 'custom',
    })),
  ]

  const selectedMember = model.selection?.type === 'member'
    ? model.members.find((m) => m.id === model.selection.id)
    : null
  const rcSections = model.sections.filter((s) => s.material !== 'steel')
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
  const showTree = activeTab === 'modeling'
  const showSectionEditor = activeTab === 'detailing'
  const showScene = activeTab === 'modeling'
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
        {['modeling','detailing','sections','bom'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding:'6px 10px',
              background: activeTab === tab ? '#0b5fff' : '#e2e8f0',
              color: activeTab === tab ? '#fff' : '#111',
              border:'none',
              borderRadius:4,
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
              if (multiSelectMode === 'nodes' && sel.type !== 'node') return
              if (multiSelectMode === 'members' && sel.type !== 'member') return
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
            onUpdateMember={(id, patch)=> updateMemberMeta(id, patch)}
            selectedDia={dia}
            setSelectedDia={setDia}
            rebarLib={rebarLib}
          />
        )}
        {showSectionEditor && (
          <SectionEditor onSectionChange={setDetailingState} selectedDia={dia} setSelectedDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} addBomLine={addBomLine} />
        )}
        {activeTab !== 'bom' && (
        <div style={{flex:1, display:'flex', flexDirection:'column'}}>
          <div style={{padding:10, borderBottom:'1px solid #eef2f7', background:'#fbfdff'}}>
            {showModelingPanel && (
              <>
                <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap'}}>
                  {[
                    { key: 'nodes', label: 'Nodes' },
                    { key: 'member', label: 'Add Member' },
                    { key: 'footing', label: 'Footing' },
                    { key: 'levels', label: 'Levels & NGL' },
                    { key: 'constraints', label: 'Constraints' },
                    { key: 'duplicate', label: 'Duplicate' },
                    { key: 'extrude', label: 'Extrude' },
                    { key: 'multi', label: 'Multi-Select' },
                  ].map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setPanelOpen((s) => ({ ...s, [item.key]: !s[item.key] }))}
                      style={{
                        padding:'6px 10px',
                        background: panelOpen[item.key] ? '#0b5fff' : '#e2e8f0',
                        color: panelOpen[item.key] ? '#fff' : '#111',
                        border:'none',
                        borderRadius:4,
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {panelOpen.nodes && (
                <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                  <div style={{fontWeight:600}}>Nodes</div>
                  <label style={{fontSize:12}}>
                    X
                    <input
                      type="number"
                      step="0.1"
                      value={nodeInput.x}
                      onChange={(e)=> setNodeInput(s => ({ ...s, x: Number(e.target.value) || 0 }))}
                      style={{width:80, marginLeft:6}}
                    />
                    <span style={{marginLeft:6, color:'#64748b'}}>m</span>
                  </label>
                  <label style={{fontSize:12}}>
                    Y
                    <input
                      type="number"
                      step="0.1"
                      value={nodeInput.y}
                      onChange={(e)=> setNodeInput(s => ({ ...s, y: Number(e.target.value) || 0 }))}
                      style={{width:80, marginLeft:6}}
                    />
                    <span style={{marginLeft:6, color:'#64748b'}}>m</span>
                  </label>
                  <label style={{fontSize:12}}>
                    Z
                    <input
                      type="number"
                      step="0.1"
                      value={nodeInput.z}
                      onChange={(e)=> setNodeInput(s => ({ ...s, z: Number(e.target.value) || 0 }))}
                      style={{width:80, marginLeft:6}}
                    />
                    <span style={{marginLeft:6, color:'#64748b'}}>m</span>
                  </label>
                  <button onClick={handleAddNodeFromInput} style={{padding:'6px 10px'}}>Add Node</button>
                  <button
                    onClick={toggleLineDraw}
                    style={{padding:'6px 10px', background: lineDrawMode ? '#0b5fff' : '#e2e8f0', color: lineDrawMode ? '#fff' : '#111', border:'none', borderRadius:4}}
                  >
                    {lineDrawMode ? 'Line Draw: On' : 'Line Draw: Off'}
                  </button>
                  {lineDrawMode && (
                    <div style={{fontSize:12, color:'#475569'}}>
                      {lineStartId ? 'Start node selected. Pick end node.' : 'Pick two nodes to create a member.'}
                    </div>
                  )}
                </div>
                )}

                {panelOpen.multi && (
                <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap'}}>
                  <div style={{fontWeight:600}}>Multi-Select</div>
                  <button
                    onClick={() => handleSetMultiSelectMode('nodes')}
                    style={{
                      padding:'6px 10px',
                      background: multiSelectMode === 'nodes' ? '#0b5fff' : '#e2e8f0',
                      color: multiSelectMode === 'nodes' ? '#fff' : '#111',
                      border:'none',
                      borderRadius:4,
                    }}
                  >
                    Nodes
                  </button>
                  <button
                    onClick={() => handleSetMultiSelectMode('members')}
                    style={{
                      padding:'6px 10px',
                      background: multiSelectMode === 'members' ? '#0b5fff' : '#e2e8f0',
                      color: multiSelectMode === 'members' ? '#fff' : '#111',
                      border:'none',
                      borderRadius:4,
                    }}
                  >
                    Members
                  </button>
                  <div style={{fontSize:12, color:'#64748b'}}>
                    {multiSelectMode === 'nodes'
                      ? 'Selecting nodes only'
                      : multiSelectMode === 'members'
                        ? 'Selecting members only'
                        : 'Normal selection'}
                  </div>
                </div>
                )}

                {panelOpen.member && (
                <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap'}}>
                  <div style={{fontWeight:600}}>Add Member</div>
                  <label style={{fontSize:12}}>
                    Node A
                    <select
                      value={memberForm.a}
                      onChange={(e)=> setMemberForm(s => ({ ...s, a: e.target.value }))}
                      style={{marginLeft:6, minWidth:180}}
                    >
                      <option value="">Select</option>
                      {model.nodes.map((n, idx) => (
                        <option key={n.id} value={n.id}>
                          #{idx} ({Number(n.position.x).toFixed(2)}, {Number(n.position.y).toFixed(2)}, {Number(n.position.z).toFixed(2)}) m
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Node B
                    <select
                      value={memberForm.b}
                      onChange={(e)=> setMemberForm(s => ({ ...s, b: e.target.value }))}
                      style={{marginLeft:6, minWidth:180}}
                    >
                      <option value="">Select</option>
                      {model.nodes.map((n, idx) => (
                        <option key={n.id} value={n.id}>
                          #{idx} ({Number(n.position.x).toFixed(2)}, {Number(n.position.y).toFixed(2)}, {Number(n.position.z).toFixed(2)}) m
                        </option>
                      ))}
                    </select>
                  </label>
                  <button onClick={handleAddMemberFromForm} style={{padding:'6px 10px'}}>Add Member</button>
                </div>
                )}
                {panelOpen.footing && (
                  <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap'}}>
                    <div style={{fontWeight:600}}>Footing</div>
                    <label style={{fontSize:12}}>
                      Section
                      <select
                        value={footingSectionId}
                        onChange={(e)=> setFootingSectionId(e.target.value)}
                        style={{marginLeft:6}}
                      >
                        <option value="">Select footing section</option>
                        {mergedSections.filter((s) => s.category === 'footing').map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}{s.source === 'custom' ? ' (Custom)' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={assignFootingSectionToSelected}
                      disabled={model.selection?.type !== 'node' || !footingSectionId}
                      style={{padding:'6px 10px'}}
                    >
                      Assign Footing to Selected Node
                    </button>
                  </div>
                )}
                {panelOpen.extrude && (
                  <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap'}}>
                    <div style={{fontWeight:600}}>Extrude</div>
                    <label style={{fontSize:12}}>
                      Section
                      <select
                        value={extrudeForm.sectionId}
                        onChange={(e)=> setExtrudeForm(s => ({ ...s, sectionId: e.target.value }))}
                        style={{marginLeft:6}}
                      >
                        <option value="">Select section</option>
                        {mergedSections.filter((s) => s.category !== 'footing').map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{fontSize:12}}>
                      dX
                      <input
                        type="number"
                        step="0.1"
                        value={extrudeForm.dx}
                        onChange={(e)=> setExtrudeForm(s => ({ ...s, dx: e.target.value }))}
                        style={{width:70, marginLeft:6}}
                      />
                      <span style={{marginLeft:6, color:'#64748b'}}>m</span>
                    </label>
                    <label style={{fontSize:12}}>
                      dY
                      <input
                        type="number"
                        step="0.1"
                        value={extrudeForm.dy}
                        onChange={(e)=> setExtrudeForm(s => ({ ...s, dy: e.target.value }))}
                        style={{width:70, marginLeft:6}}
                      />
                      <span style={{marginLeft:6, color:'#64748b'}}>m</span>
                    </label>
                    <label style={{fontSize:12}}>
                      dZ
                      <input
                        type="number"
                        step="0.1"
                        value={extrudeForm.dz}
                        onChange={(e)=> setExtrudeForm(s => ({ ...s, dz: e.target.value }))}
                        style={{width:70, marginLeft:6}}
                      />
                      <span style={{marginLeft:6, color:'#64748b'}}>m</span>
                    </label>
                    <label style={{fontSize:12}}>
                      Count
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={extrudeForm.count}
                        onChange={(e)=> setExtrudeForm(s => ({ ...s, count: Number(e.target.value) || 1 }))}
                        style={{width:70, marginLeft:6}}
                      />
                    </label>
                    <button
                      onClick={handleExtrude}
                      disabled={model.selection?.type !== 'node' || !extrudeForm.sectionId}
                      style={{padding:'6px 10px'}}
                    >
                      Apply Extrude
                    </button>
                    <div style={{fontSize:12, color:'#64748b'}}>Select a node first.</div>
                  </div>
                )}
              </>
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
                <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10, flexWrap:'wrap'}}>
                  <label style={{fontSize:12}}>
                    Detail Section
                    <select
                      value={detailTargetSectionId}
                      onChange={(e)=> setDetailTargetSectionId(e.target.value)}
                      style={{marginLeft:6}}
                    >
                      <option value="">Select section</option>
                      {rcSections.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                      ))}
                    </select>
                  </label>
                  <button onClick={applyDetailingToSection} disabled={!detailingState || !detailTargetSectionId} style={{padding:'6px 10px'}}>
                    Apply Detailing
                  </button>
                  <button onClick={validateDetailing} style={{padding:'6px 10px'}}>
                    Validate Model
                  </button>
                </div>
                {validationReport && (
                  <div style={{marginTop:8, fontSize:12}}>
                    <div style={{color: validationReport.missingSections.length ? '#b91c1c' : '#166534'}}>
                      Sections missing detailing: {validationReport.missingSections.length}
                    </div>
                    <div style={{color: validationReport.missingMembers.length ? '#b91c1c' : '#166534'}}>
                      Members missing detailing: {validationReport.missingMembers.length}
                    </div>
                    <div style={{color: validationReport.missingFootings.length ? '#b91c1c' : '#166534'}}>
                      Footings missing detailing: {validationReport.missingFootings.length}
                    </div>
                  </div>
                )}
              </>
            )}
            {showModelingPanel && (
              <>
            {panelOpen.levels && (
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
                Show Grid
                <input
                  type="checkbox"
                  checked={!!model.showGrid}
                  onChange={(e)=> applyModel({ ...model, showGrid: e.target.checked })}
                  style={{marginLeft:6}}
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
                View
                <select
                  value={viewMode}
                  onChange={(e)=> setViewMode(e.target.value)}
                  style={{marginLeft:6}}
                >
                  <option value="lines">Show lines only</option>
                  <option value="geometry">Show geometry</option>
                  <option value="edges">Show edges only</option>
                  <option value="rebars">Show rebars only</option>
                </select>
              </label>
              <button
                onClick={() => setRotateEnabled((v) => !v)}
                style={{padding:'6px 10px'}}
              >
                {rotateEnabled ? 'Rotate: On' : 'Rotate: Off'}
              </button>
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
            {panelOpen.levels && model.floors && model.floors.length > 0 && (
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
              <div style={{fontWeight:600}}>Selection</div>
              <div style={{fontSize:12}}>
                {model.selection?.type ? `${model.selection.type} ${model.selection.id?.slice(0,6)}` : 'None'}
              </div>
              {multiNodeIds.length > 1 && (
                <div style={{fontSize:12, color:'#475569'}}>
                  Multi nodes: {multiNodeIds.length}
                </div>
              )}
              <button onClick={clearSelection} disabled={!model.selection?.type} style={{padding:'6px 10px'}}>Unselect</button>
              {model.selection?.type === 'member' && selectedMember && (
                <>
                  <label style={{fontSize:12}}>
                    Type
                    <select
                      value={selectedMember.type || 'beam'}
                      onChange={(e)=> updateMemberMeta(selectedMember.id, { type: e.target.value })}
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
                      value={selectedMember.align || 'center'}
                      onChange={(e)=> updateMemberMeta(selectedMember.id, { align: e.target.value })}
                      style={{marginLeft:6}}
                    >
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Section
                    <select
                    value={memberSectionChoice}
                      onChange={(e)=> setMemberSectionChoice(e.target.value)}
                      style={{marginLeft:6}}
                    >
                      <option value="">None</option>
                      {mergedSections.filter(s => s.category === (selectedMember.type || 'beam')).map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.source === 'custom' ? ' (Custom)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button onClick={assignSectionToSelectedMember} disabled={!memberSectionChoice} style={{padding:'6px 10px'}}>Assign Section</button>
                  <label style={{fontSize:12}}>
                    Preview
                    <select
                      value={selectedMember.preview || 'shape'}
                      onChange={(e)=> updateMemberMeta(selectedMember.id, { preview: e.target.value })}
                      style={{marginLeft:6}}
                    >
                      <option value="shape">Shape</option>
                      <option value="line">Line</option>
                    </select>
                  </label>
                  <div style={{fontSize:12, color:'#475569'}}>
                    Beta: {Number(selectedMember?.beta || 0).toFixed(1)} deg
                  </div>
                  <button onClick={openBetaModal} style={{padding:'6px 10px'}}>
                    Beta Angle
                  </button>
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
                    onChange={(e)=> updateFootingSection(model.selection.id, e.target.value)}
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
            {panelOpen.constraints && (
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
            {panelOpen.duplicate && (
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:12, flexWrap:'wrap'}}>
              <div style={{fontWeight:600}}>Duplicate</div>
              <label style={{fontSize:12}}>
                dX
                <input
                  type="number"
                  step="0.1"
                  value={dupOffset.x}
                  onChange={(e)=> setDupOffset(s => ({ ...s, x: e.target.value }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                dY
                <input
                  type="number"
                  step="0.1"
                  value={dupOffset.y}
                  onChange={(e)=> setDupOffset(s => ({ ...s, y: e.target.value }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <label style={{fontSize:12}}>
                dZ
                <input
                  type="number"
                  step="0.1"
                  value={dupOffset.z}
                  onChange={(e)=> setDupOffset(s => ({ ...s, z: e.target.value }))}
                  style={{width:70, marginLeft:6}}
                />
              </label>
              <button onClick={duplicateNode} disabled={model.selection?.type !== 'node'}>Duplicate Node</button>
              <button onClick={duplicateMember} disabled={model.selection?.type !== 'member'}>Duplicate Member</button>
            </div>
            )}
              </>
            )}
            {showSectionsPanel && (
              <div style={{marginTop:12}}>
                <div style={{fontWeight:600, marginBottom:8}}>Section Properties</div>
                <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                  <label style={{fontSize:12}}>
                    Category
                    <select
                      value={sectionForm.category}
                      onChange={(e)=> setSectionForm(s => ({ ...s, category: e.target.value }))}
                      style={{marginLeft:6}}
                    >
                      <option value="beam">Beam</option>
                      <option value="column">Column</option>
                      {sectionForm.material !== 'steel' && <option value="pedestal">Pedestal</option>}
                      {sectionForm.material !== 'steel' && <option value="footing">Footing</option>}
                    </select>
                  </label>
                  <label style={{fontSize:12}}>
                    Material
                    <select
                      value={sectionForm.material}
                      onChange={(e)=> setSectionForm(s => ({ ...s, material: e.target.value }))}
                      style={{marginLeft:6}}
                    >
                      <option value="rc">Reinforced Concrete</option>
                      <option value="steel">Steel</option>
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
                  {sectionForm.material === 'steel' ? (
                    <>
                      <label style={{fontSize:12}}>
                        Units
                        <select
                          value={aiscUnits}
                          onChange={(e)=> {
                            setAiscUnits(e.target.value)
                            setSectionForm(s => ({ ...s, steelShape: '' }))
                          }}
                          style={{marginLeft:6}}
                        >
                          <option value="metric">Metric</option>
                          <option value="imperial">Imperial</option>
                        </select>
                      </label>
                      <label style={{fontSize:12}}>
                        Steel Type
                        <select
                          value={aiscType}
                          onChange={(e)=> {
                            setAiscType(e.target.value)
                            setSectionForm(s => ({ ...s, steelType: e.target.value, steelShape: '' }))
                          }}
                          style={{marginLeft:6}}
                        >
                          <option value="W">W</option>
                          <option value="C">C</option>
                          <option value="L">L</option>
                          <option value="HSS">HSS</option>
                          <option value="WT">WT</option>
                          <option value="PIPE">PIPE</option>
                          <option value="2L">2L</option>
                        </select>
                      </label>
                      <label style={{fontSize:12}}>
                        Steel Section
                        <select
                          value={sectionForm.steelShape}
                          onChange={(e)=> setSectionForm(s => ({ ...s, steelShape: e.target.value }))}
                          style={{marginLeft:6, minWidth:180}}
                        >
                          <option value="">Select</option>
                          {aiscShapes.map((s) => (
                            <option key={s.label} value={s.label}>{s.label}</option>
                          ))}
                        </select>
                      </label>
                      {aiscLoading && <div style={{fontSize:12, color:'#64748b'}}>Loading AISC...</div>}
                      {aiscError && <div style={{fontSize:12, color:'#b45309'}}>{aiscError}</div>}
                    </>
                  ) : (
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
                  {sectionForm.category === 'footing' && (
                    <label style={{fontSize:12}}>
                      l
                      <input
                        type="number"
                        step="0.01"
                        value={sectionForm.l}
                        onChange={(e)=> setSectionForm(s => ({ ...s, l: Number(e.target.value) || 0 }))}
                        style={{width:70, marginLeft:6}}
                      />
                    </label>
                  )}
                      {sectionForm.category === 'footing' && (
                        <label style={{fontSize:12}}>
                          l
                          <input
                            type="number"
                            step="0.01"
                            value={sectionForm.l}
                            onChange={(e)=> setSectionForm(s => ({ ...s, l: Number(e.target.value) || 0 }))}
                            style={{width:70, marginLeft:6}}
                          />
                        </label>
                      )}
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
                    </>
                  )}
                  <button onClick={handleAddSection} style={{padding:'6px 10px'}}>Add Section</button>
                  <button onClick={handleSaveCustomShape} disabled={!hasConfig || !firebaseUid || sectionForm.material === 'steel'} style={{padding:'6px 10px'}}>
                    Save Custom Shape
                  </button>
                </div>
                {!isPremium && (
                  <div style={{fontSize:12, color:'#b45309', marginTop:6}}>
                    Custom shapes are premium.
                  </div>
                )}
                <div style={{fontSize:12, color:'#64748b', marginTop:6}}>Detail sections in the Detailing tab.</div>
                {customShapes.length > 0 && (
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
                {mergedSections && mergedSections.length > 0 && (
                  <div style={{marginTop:8}}>
                    {mergedSections.map((s) => (
                      <div key={s.id} style={{display:'flex', alignItems:'center', gap:8, marginBottom:4}}>
                        <div style={{minWidth:110, fontSize:12}}>{s.category}</div>
                        <div style={{minWidth:90, fontSize:12}}>{s.material === 'steel' ? 'Steel' : 'RC'}</div>
                        <div style={{flex:1, fontSize:12}}>
                          {s.name}
                          {s.material === 'steel' && s.steelType && s.steelShape ? ` (${s.steelType} ${s.steelShape})` : ''}
                          {s.material !== 'steel' && s.dims ? ` (b${s.dims.b || 0} h${s.dims.h || 0}${s.dims.l ? ` l${s.dims.l}` : ''})` : ''}
                        </div>
                    <button onClick={()=> openEditSection(s)}>Edit</button>
                    {s.source === 'custom' ? (
                      <div style={{fontSize:12, color:'#64748b'}}>Custom</div>
                    ) : (
                      <button onClick={()=> handleRemoveSection(s.id)}>Remove</button>
                    )}
                  </div>
                ))}
              </div>
            )}
              </div>
            )}
          </div>
          {showScene && (
            <div style={{flex:1}}>
                <ThreeScene
                  ref={threeRef}
                  model={model}
                  sections={mergedSections}
                  initialModel={initialModelRef.current}
                floors={model.floors}
                nglElevation={model.ngl}
                showGrid={!!model.showGrid}
                showVerticalGrid={!!model.showVerticalGrid}
                  viewMode={viewMode}
                  multiSelectMode={multiSelectMode}
                  lineDrawMode={lineDrawMode}
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
        </div>)}
        {showBOM && (
          <BOMPanel dia={dia} setDia={setDia} length={length} setLength={setLength} count={count} setCount={setCount} bomLines={bomLines} setBomLines={setBomLines} />
        )}
      </div>
      {pendingDelete && (
        <ConfirmModal open={!!pendingDelete} title={`Delete ${pendingDelete.label}`} message={`Are you sure you want to delete ${pendingDelete.label}?`} onConfirm={confirmDelete} onCancel={()=>setPendingDelete(null)} />
      )}
      {betaModalOpen && (
        <div style={{position:'fixed', inset:0, background:'rgba(15,23,42,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}}>
          <div style={{background:'#fff', padding:16, borderRadius:8, width:320, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
            <div style={{fontWeight:600, marginBottom:8}}>Set Beta Angle</div>
            <label style={{fontSize:12, display:'block'}}>
              Beta (deg)
              <input
                type="number"
                step="0.1"
                value={betaValue}
                onChange={(e)=> setBetaValue(e.target.value)}
                style={{width:'100%', marginTop:6}}
              />
            </label>
            <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:12}}>
              <button onClick={()=> setBetaModalOpen(false)}>Cancel</button>
              <button onClick={applyBetaAngle}>Apply</button>
            </div>
          </div>
        </div>
      )}
      {editSectionOpen && editSectionForm && (
        <div style={{position:'fixed', inset:0, background:'rgba(15,23,42,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000}}>
          <div style={{background:'#fff', padding:16, borderRadius:8, width:360, boxShadow:'0 10px 30px rgba(0,0,0,0.2)'}}>
            <div style={{fontWeight:600, marginBottom:8}}>Edit Section</div>
            <label style={{fontSize:12, display:'block', marginBottom:8}}>
              Name
              <input
                type="text"
                value={editSectionForm.name}
                onChange={(e)=> setEditSectionForm(s => ({ ...s, name: e.target.value }))}
                style={{width:'100%', marginTop:6}}
              />
            </label>
            <label style={{fontSize:12, display:'block', marginBottom:8}}>
              Category
              <select
                value={editSectionForm.category}
                onChange={(e)=> setEditSectionForm(s => ({ ...s, category: e.target.value }))}
                style={{width:'100%', marginTop:6}}
              >
                <option value="beam">Beam</option>
                <option value="column">Column</option>
                {editSectionForm.material !== 'steel' && <option value="pedestal">Pedestal</option>}
                {editSectionForm.material !== 'steel' && <option value="footing">Footing</option>}
              </select>
            </label>
            <div style={{fontSize:12, marginBottom:8}}>
              Material: {editSectionForm.material === 'steel' ? 'Steel' : 'RC'}
            </div>
            {editSectionForm.material === 'steel' ? (
              <>
                <label style={{fontSize:12, display:'block', marginBottom:8}}>
                  Units
                  <select
                    value={editAiscUnits}
                    onChange={(e)=> {
                      setEditAiscUnits(e.target.value)
                      setEditSectionForm(s => ({ ...s, steelShape: '' }))
                    }}
                    style={{width:'100%', marginTop:6}}
                  >
                    <option value="metric">Metric</option>
                    <option value="imperial">Imperial</option>
                  </select>
                </label>
                <label style={{fontSize:12, display:'block', marginBottom:8}}>
                  Steel Type
                  <select
                    value={editAiscType}
                    onChange={(e)=> {
                      setEditAiscType(e.target.value)
                      setEditSectionForm(s => ({ ...s, steelType: e.target.value, steelShape: '' }))
                    }}
                    style={{width:'100%', marginTop:6}}
                  >
                    <option value="W">W</option>
                    <option value="C">C</option>
                    <option value="L">L</option>
                    <option value="HSS">HSS</option>
                    <option value="WT">WT</option>
                    <option value="PIPE">PIPE</option>
                    <option value="2L">2L</option>
                  </select>
                </label>
                <label style={{fontSize:12, display:'block', marginBottom:8}}>
                  Steel Section
                  <select
                    value={editSectionForm.steelShape}
                    onChange={(e)=> setEditSectionForm(s => ({ ...s, steelShape: e.target.value }))}
                    style={{width:'100%', marginTop:6}}
                  >
                    <option value="">Select</option>
                    {editAiscShapes.map((s) => (
                      <option key={s.label || s.std} value={s.label || s.std}>
                        {s.label || s.std}
                      </option>
                    ))}
                  </select>
                </label>
                {editAiscLoading && <div style={{fontSize:12, color:'#64748b'}}>Loading AISC...</div>}
                {editAiscError && <div style={{fontSize:12, color:'#b45309'}}>{editAiscError}</div>}
              </>
            ) : (
              <>
                <label style={{fontSize:12, display:'block', marginBottom:8}}>
                  Centroid
                  <select
                    value={editSectionForm.centroid}
                    onChange={(e)=> setEditSectionForm(s => ({ ...s, centroid: e.target.value }))}
                    style={{width:'100%', marginTop:6}}
                  >
                    <option value="center">Center</option>
                    <option value="top">Top</option>
                  </select>
                </label>
                <label style={{fontSize:12, display:'block', marginBottom:8}}>
                  b
                  <input
                    type="number"
                    step="0.01"
                    value={editSectionForm.b}
                    onChange={(e)=> setEditSectionForm(s => ({ ...s, b: e.target.value }))}
                    style={{width:'100%', marginTop:6}}
                  />
                </label>
                <label style={{fontSize:12, display:'block', marginBottom:8}}>
                  h
                  <input
                    type="number"
                    step="0.01"
                    value={editSectionForm.h}
                    onChange={(e)=> setEditSectionForm(s => ({ ...s, h: e.target.value }))}
                    style={{width:'100%', marginTop:6}}
                  />
                </label>
                {editSectionForm.category === 'footing' && (
                  <label style={{fontSize:12, display:'block', marginBottom:8}}>
                    l
                    <input
                      type="number"
                      step="0.01"
                      value={editSectionForm.l}
                      onChange={(e)=> setEditSectionForm(s => ({ ...s, l: e.target.value }))}
                      style={{width:'100%', marginTop:6}}
                    />
                  </label>
                )}
              </>
            )}
            <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:12}}>
              <button onClick={()=> setEditSectionOpen(false)}>Cancel</button>
              <button onClick={applySectionEdit}>Save</button>
            </div>
          </div>
        </div>
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
