const STORAGE_KEY = 'ossm.model.v1'

function normalizeSelection(selection) {
  if (!selection || typeof selection !== 'object') {
    return { type: null, id: null }
  }
  const type = selection.type === 'node' || selection.type === 'member' || selection.type === 'footing' ? selection.type : null
  const id = typeof selection.id === 'string' ? selection.id : null
  return { type, id }
}

export function createEmptyModel() {
  return {
    nodes: [],
    members: [],
    footings: [],
    floors: [],
    ngl: 0,
    sections: [],
    snapToLevel: false,
    activeLevelId: null,
    axisLock: 'none',
    constrainMembers: false,
    showVerticalGrid: true,
    selection: { type: null, id: null },
  }
}

export function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object') return createEmptyModel()
  return {
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    members: Array.isArray(raw.members) ? raw.members : [],
    footings: Array.isArray(raw.footings) ? raw.footings : [],
    floors: Array.isArray(raw.floors) ? raw.floors : [],
    ngl: typeof raw.ngl === 'number' ? raw.ngl : 0,
    sections: Array.isArray(raw.sections) ? raw.sections : [],
    snapToLevel: typeof raw.snapToLevel === 'boolean' ? raw.snapToLevel : false,
    activeLevelId: typeof raw.activeLevelId === 'string' ? raw.activeLevelId : null,
    axisLock: raw.axisLock === 'x' || raw.axisLock === 'y' || raw.axisLock === 'z' ? raw.axisLock : 'none',
    constrainMembers: typeof raw.constrainMembers === 'boolean' ? raw.constrainMembers : false,
    showVerticalGrid: typeof raw.showVerticalGrid === 'boolean' ? raw.showVerticalGrid : true,
    selection: normalizeSelection(raw.selection),
  }
}

export function loadModel() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeModel(JSON.parse(raw))
  } catch (_) {
    return null
  }
}

export function saveModel(model) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeModel(model)))
  } catch (_) {
    // ignore persistence failures (storage quota, private mode)
  }
}

export function setSelection(model, selection) {
  return { ...model, selection: normalizeSelection(selection) }
}

export function addFloor(model, floor) {
  const next = floor || {}
  const item = {
    id: next.id || `floor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: next.name || `Floor ${model.floors.length + 1}`,
    elevation: typeof next.elevation === 'number' ? next.elevation : 0,
  }
  return { ...model, floors: [...model.floors, item] }
}

export function updateFloor(model, floorId, patch) {
  const floors = model.floors.map((f) => (f.id === floorId ? { ...f, ...patch } : f))
  return { ...model, floors }
}

export function removeFloor(model, floorId) {
  const floors = model.floors.filter((f) => f.id !== floorId)
  return { ...model, floors }
}

export function addSection(model, section) {
  const next = section || {}
  const item = {
    id: next.id || `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: next.name || 'Section',
    category: next.category || 'beam',
    material: next.material || 'rc',
    shape: next.shape || 'rect',
    dims: next.dims || { b: 0.3, h: 0.5 },
    centroid: next.centroid || 'center',
    steelType: next.steelType || null,
    steelShape: next.steelShape || null,
    aiscUnits: next.aiscUnits || null,
    aiscDims: next.aiscDims || null,
  }
  return { ...model, sections: [...model.sections, item] }
}

export function updateSection(model, sectionId, patch) {
  const sections = model.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s))
  return { ...model, sections }
}

export function removeSection(model, sectionId) {
  const sections = model.sections.filter((s) => s.id !== sectionId)
  return {
    ...model,
    sections,
    members: model.members.map((m) => (m.sectionId === sectionId ? { ...m, sectionId: null } : m)),
    footings: model.footings.map((f) => (f.sectionId === sectionId ? { ...f, sectionId: null } : f)),
  }
}

export function addFooting(model, nodeId, size) {
  if (!nodeId) return model
  const footing = {
    id: `footing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    nodeId,
    size: size || { x: 1, y: 0.4, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  }
  return { ...model, footings: [...model.footings, footing] }
}

export function updateFooting(model, footingId, patch) {
  const footings = model.footings.map((f) => (f.id === footingId ? { ...f, ...patch } : f))
  return { ...model, footings }
}

export function updateNodePosition(model, nodeId, position) {
  const nodes = model.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n))
  return { ...model, nodes }
}

export function translateNode(model, nodeId, delta) {
  const nodes = model.nodes.map((n) => {
    if (n.id !== nodeId || !n.position) return n
    return {
      ...n,
      position: {
        x: n.position.x + (delta?.x || 0),
        y: n.position.y + (delta?.y || 0),
        z: n.position.z + (delta?.z || 0),
      },
    }
  })
  return { ...model, nodes }
}

export function translateFooting(model, footingId, delta) {
  const footings = model.footings.map((f) => {
    if (f.id !== footingId) return f
    const offset = f.offset || { x: 0, y: 0, z: 0 }
    return {
      ...f,
      offset: {
        x: offset.x + (delta?.x || 0),
        y: offset.y + (delta?.y || 0),
        z: offset.z + (delta?.z || 0),
      },
    }
  })
  return { ...model, footings }
}

export function rotateFooting(model, footingId, deltaDeg) {
  const footings = model.footings.map((f) => {
    if (f.id !== footingId) return f
    const rot = f.rotation || { x: 0, y: 0, z: 0 }
    return {
      ...f,
      rotation: {
        x: rot.x + (deltaDeg?.x || 0),
        y: rot.y + (deltaDeg?.y || 0),
        z: rot.z + (deltaDeg?.z || 0),
      },
    }
  })
  return { ...model, footings }
}

export function rotateMember(model, memberId, deltaDeg) {
  const members = model.members.map((m) => {
    if (m.id !== memberId) return m
    const rot = m.rotation || { x: 0, y: 0, z: 0 }
    return {
      ...m,
      rotation: {
        x: rot.x + (deltaDeg?.x || 0),
        y: rot.y + (deltaDeg?.y || 0),
        z: rot.z + (deltaDeg?.z || 0),
      },
    }
  })
  return { ...model, members }
}

export function translateSelection(model, selection, delta) {
  const sel = normalizeSelection(selection)
  if (sel.type === 'node') return translateNode(model, sel.id, delta)
  if (sel.type === 'footing') return translateFooting(model, sel.id, delta)
  return model
}

export function buildSceneGraph(model) {
  const nodesById = Object.fromEntries(model.nodes.map((n) => [n.id, n]))
  const membersById = Object.fromEntries(model.members.map((m) => [m.id, m]))
  const nodeMembers = {}
  model.members.forEach((m) => {
    if (!nodeMembers[m.a]) nodeMembers[m.a] = []
    if (!nodeMembers[m.b]) nodeMembers[m.b] = []
    nodeMembers[m.a].push(m.id)
    nodeMembers[m.b].push(m.id)
  })
  return { nodesById, membersById, nodeMembers }
}
