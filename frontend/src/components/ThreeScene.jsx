import React, {
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

// local snap helper to avoid import mismatches
function snapToGrid(v, grid = 1) {
  return new THREE.Vector3(
    Math.round(v.x / grid) * grid,
    Math.round(v.y / grid) * grid,
    Math.round(v.z / grid) * grid
  )
}

const ThreeScene = forwardRef((props, ref) => {
  const mountRef = useRef(null)

  const [snapEnabled, setSnapEnabled] = useState(true)
  const [gridSize, setGridSize] = useState(0.5)
  const [gridDivisions, setGridDivisions] = useState(40)

  const nodesRef = useRef([]) // array of THREE.Mesh (spheres)
  const membersRef = useRef([]) // array of { line: THREE.Line, aNode: Mesh, bNode: Mesh }
  const footingsRef = useRef([]) // array of { id, mesh, nodeId, size, offset, rotation }
  const selectedMemberRef = useRef(null)
  const selectedFootingRef = useRef(null)
  const selectedRef = useRef(null)
  const selectedMembersRef = useRef(new Set())
  const addNodeRef = useRef(null)
  const addMemberRef = useRef(null)
  const addFootingRef = useRef(null)

  const [selectedId, setSelectedId] = useState(null)
  const [tool, setTool] = useState('select') // 'select' | 'extrude'
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0, z: 0 })
  const rotateModeRef = useRef(false)

  const baseLineColor = 0x333333
  const primaryLineColor = 0xff0000
  const multiLineColor = 0xffa500

  function setMemberVisual(m, mode) {
    if (!m || !m.line) return
    if (mode === 'primary') {
      m.line.material && m.line.material.color.setHex(primaryLineColor)
      m.mesh?.material?.emissive?.setHex?.(0x222222)
    } else if (mode === 'multi') {
      m.line.material && m.line.material.color.setHex(multiLineColor)
      m.mesh?.material?.emissive?.setHex?.(0x553300)
    } else {
      m.line.material && m.line.material.color.setHex(baseLineColor)
      m.mesh?.material?.emissive?.setHex?.(0x000000)
    }
  }

  function refreshMemberVisuals() {
    const primaryId = selectedMemberRef.current?.id
    membersRef.current.forEach((m) => {
      if (m.id === primaryId) return setMemberVisual(m, 'primary')
      if (selectedMembersRef.current.has(m.id)) return setMemberVisual(m, 'multi')
      setMemberVisual(m, 'none')
    })
  }

  const rulerTopRef = useRef(null)
  const rulerLeftRef = useRef(null)
  const guideLinesRef = useRef(null)

  // expose API to parent
  useImperativeHandle(ref, () => ({
    getNodes: () =>
      nodesRef.current.map((n, idx) => ({
        index: idx,
        id: n.userData.id,
        position: { x: n.position.x, y: n.position.y, z: n.position.z },
      })),
    selectNode: (id) => {
      const found = nodesRef.current.find((n) => n.userData.id === id)
      if (!found) return

      selectedMembersRef.current.clear()
      refreshMemberVisuals()
      if (selectedRef.current && selectedRef.current !== found) {
        selectedRef.current.material?.emissive?.setHex?.(0x000000)
      }
      if (selectedMemberRef.current) {
        selectedMemberRef.current.line.material &&
          selectedMemberRef.current.line.material.color.setHex(0x333333)
        selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
        selectedMemberRef.current = null
      }
      if (selectedFootingRef.current) {
        selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
        selectedFootingRef.current = null
      }
      selectedRef.current = found
      setSelectedId(found.userData.id)
      props.onSelectionChange && props.onSelectionChange({ type: 'node', id: found.userData.id })
      found.material?.emissive?.setHex?.(0x222222)
    },
    selectMember: (id) => {
      const found = membersRef.current.find((m) => m.id === id)
      if (!found) return
      selectedMembersRef.current = new Set([found.id])
      if (selectedRef.current) {
        selectedRef.current.material?.emissive?.setHex?.(0x000000)
        selectedRef.current = null
      }
      if (selectedMemberRef.current && selectedMemberRef.current !== found) {
        selectedMemberRef.current.line.material &&
          selectedMemberRef.current.line.material.color.setHex(0x333333)
        selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
      }
      if (selectedFootingRef.current) {
        selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
        selectedFootingRef.current = null
      }
      selectedMemberRef.current = found
      setSelectedId(null)
      props.onSelectionChange && props.onSelectionChange({ type: 'member', id: found.id, multi: Array.from(selectedMembersRef.current) })
      refreshMemberVisuals()
    },
    selectFooting: (id) => {
      const found = footingsRef.current.find((f) => f.id === id)
      if (!found) return
      selectedMembersRef.current.clear()
      refreshMemberVisuals()
      if (selectedRef.current) {
        selectedRef.current.material?.emissive?.setHex?.(0x000000)
        selectedRef.current = null
      }
      if (selectedMemberRef.current) {
        selectedMemberRef.current.line.material &&
          selectedMemberRef.current.line.material.color.setHex(0x333333)
        selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
        selectedMemberRef.current = null
      }
      if (selectedFootingRef.current && selectedFootingRef.current !== found) {
        selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
      }
      selectedFootingRef.current = found
      setSelectedId(null)
      props.onSelectionChange && props.onSelectionChange({ type: 'footing', id: found.id })
      found.mesh.material?.emissive?.setHex?.(0x222222)
    },
    deleteNode: (id) => {
      // remove node and attached members
      const idx = nodesRef.current.findIndex((n) => n.userData.id === id)
      if (idx === -1) return false
      const node = nodesRef.current[idx]
      // remove attached members
      const attached = membersRef.current.filter((m) => m.aNode === node || m.bNode === node)
      attached.forEach((m) => {
        m.line.parent && m.line.parent.remove(m.line)
      })
      membersRef.current = membersRef.current.filter((m) => m.aNode !== node && m.bNode !== node)
      // remove attached footings
      const attachedFootings = footingsRef.current.filter((f) => f.nodeId === id)
      attachedFootings.forEach((f) => f.mesh.parent && f.mesh.parent.remove(f.mesh))
      footingsRef.current = footingsRef.current.filter((f) => f.nodeId !== id)
      // remove node
      node.parent && node.parent.remove(node)
      nodesRef.current.splice(idx, 1)
      if (selectedRef.current === node) selectedRef.current = null
      setSelectedId(null)
      props.onSelectionChange && props.onSelectionChange({ type: null, id: null })
      emitSceneChange()
      return true
    },
    deleteMember: (memberId) => {
      const mi = membersRef.current.findIndex((m) => m.id === memberId)
      if (mi === -1) return false
      const m = membersRef.current[mi]
      m.line.parent && m.line.parent.remove(m.line)
      if (m.mesh && m.mesh.parent) m.mesh.parent.remove(m.mesh)
      membersRef.current.splice(mi, 1)
      selectedMembersRef.current.delete(memberId)
      selectedMemberRef.current = null
      refreshMemberVisuals()
      props.onSelectionChange && props.onSelectionChange({ type: null, id: null })
      emitSceneChange()
      return true
    },
    setMemberSelection: (ids) => {
      const list = Array.isArray(ids) ? ids : []
      selectedMembersRef.current = new Set(list)
      const primaryId = list.length ? list[list.length - 1] : null
      const primaryMember = primaryId
        ? membersRef.current.find((m) => m.id === primaryId) || null
        : null
      selectedMemberRef.current = primaryMember
      selectedRef.current = null
      setSelectedId(null)
      refreshMemberVisuals()
      if (selectedMemberRef.current) {
        props.onSelectionChange && props.onSelectionChange({ type: 'member', id: selectedMemberRef.current.id, multi: Array.from(selectedMembersRef.current) })
      } else {
        props.onSelectionChange && props.onSelectionChange({ type: null, id: null })
      }
    },
    deleteFooting: (footingId) => {
      const fi = footingsRef.current.findIndex((f) => f.id === footingId)
      if (fi === -1) return false
      const f = footingsRef.current[fi]
      f.mesh.parent && f.mesh.parent.remove(f.mesh)
      footingsRef.current.splice(fi, 1)
      selectedFootingRef.current = null
      props.onSelectionChange && props.onSelectionChange({ type: null, id: null })
      emitSceneChange()
      return true
    },
    addNode: (pos) => {
      if (addNodeRef.current) {
        const mesh = addNodeRef.current(pos)
        return mesh?.userData?.id
      }
      return null
    },
    addMember: (aId, bId) => {
      if (!addMemberRef.current) return null
      const a = nodesRef.current.find(n=>n.userData.id===aId)
      const b = nodesRef.current.find(n=>n.userData.id===bId)
      if (!a || !b) return null
      const m = addMemberRef.current(a, b)
      return m?.id
    },
    addFooting: (nodeId, size) => {
      if (!addFootingRef.current) return null
      const node = nodesRef.current.find((n) => n.userData.id === nodeId)
      if (!node) return null
      const f = addFootingRef.current(node, size)
      return f?.id
    },
    setModel: (model) => {
      if (loadModelRef.current) loadModelRef.current(model)
    },
  }))

  const loadModelRef = useRef(null)
  const updateMemberOffsetsRef = useRef(null)

  // helper to emit full scene snapshot
  function emitSceneChange() {
    const nodes = nodesRef.current.map((n, i) => ({
      index: i,
      id: n.userData.id,
      position: { x: n.position.x, y: n.position.y, z: n.position.z },
    }))
    const members = membersRef.current.map((m) => ({
      id: m.id,
      a: m.aNode.userData.id,
      b: m.bNode.userData.id,
    }))
    const footings = footingsRef.current.map((f) => ({
      id: f.id,
      nodeId: f.nodeId,
      size: f.size,
      offset: f.offset,
      rotation: f.rotation,
    }))
    props.onSceneChange && props.onSceneChange({ nodes, members, footings })
  }

  useEffect(() => {
    const el = mountRef.current
    if (!el) return

    // --- Scene setup ---
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf4f7fb)

    const width = el.clientWidth || 800
    const height = el.clientHeight || 600

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(10, 12, 16)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0, 0)
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.NONE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.DOLLY,
    }
    controls.enableRotate = false
    controls.update()

    // Lights
    const light = new THREE.DirectionalLight(0xffffff, 0.9)
    light.position.set(10, 20, 10)
    scene.add(light)

    const ambient = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambient)

    // Grid + axes
    const grid = new THREE.GridHelper(
      gridSize * gridDivisions,
      gridDivisions,
      0x444444,
      0x888888
    )
    grid.userData.isGrid = true
    scene.add(grid)

    const axes = new THREE.AxesHelper(5)
    scene.add(axes)

    // Floors, NGL, and vertical gridlines
    const floorGroup = new THREE.Group()
    scene.add(floorGroup)
    const floorMat = new THREE.LineBasicMaterial({ color: 0x9aa7b8 })
    const size = gridSize * gridDivisions
    const half = size / 2
    const floors = Array.isArray(props.floors) ? props.floors : []
    const elevations = floors.map((f) => (typeof f.elevation === 'number' ? f.elevation : 0))
    const nglElevation = typeof props.nglElevation === 'number' ? props.nglElevation : 0
    const minY = Math.min(0, nglElevation, ...elevations)
    const maxY = Math.max(0, nglElevation, ...elevations, minY + 0.01)

    floors.forEach((f) => {
      const y = typeof f.elevation === 'number' ? f.elevation : 0
      const points = [
        new THREE.Vector3(-half, y, -half),
        new THREE.Vector3(half, y, -half),
        new THREE.Vector3(half, y, half),
        new THREE.Vector3(-half, y, half),
        new THREE.Vector3(-half, y, -half),
      ]
      const geom = new THREE.BufferGeometry().setFromPoints(points)
      const line = new THREE.Line(geom, floorMat)
      floorGroup.add(line)
    })

    const nglGeom = new THREE.PlaneGeometry(size, size)
    const nglMat = new THREE.MeshBasicMaterial({
      color: 0x7fc8a9,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
    })
    const nglPlane = new THREE.Mesh(nglGeom, nglMat)
    nglPlane.rotation.x = -Math.PI / 2
    nglPlane.position.y = nglElevation
    scene.add(nglPlane)

    if (props.showVerticalGrid) {
      const step = gridSize
      const positions = []
      for (let x = -half; x <= half + 0.0001; x += step) {
        for (let z = -half; z <= half + 0.0001; z += step) {
          positions.push(x, minY, z, x, maxY, z)
        }
      }
      const vgGeom = new THREE.BufferGeometry()
      vgGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const vgMat = new THREE.LineBasicMaterial({ color: 0xd3dbe6, transparent: true, opacity: 0.6 })
      const vLines = new THREE.LineSegments(vgGeom, vgMat)
      scene.add(vLines)
    }

    // Guide crosshair lines
    const guideMat = new THREE.LineBasicMaterial({
      color: 0x0088ff,
      transparent: true,
      opacity: 0.8,
    })
    const gx = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      guideMat
    )
    const gz = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      guideMat
    )
    gx.visible = false
    gz.visible = false
    scene.add(gx, gz)
    guideLinesRef.current = [gx, gz]

    // Ground plane for raycast
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    plane.rotateX(-Math.PI / 2)
    scene.add(plane)

    // omit demo geometry for a clean scene

    // --- Helpers ---
    function addNode(pos, forcedId) {
      const geo = new THREE.SphereGeometry(0.12, 12, 12)
      const mat = new THREE.MeshStandardMaterial({ color: 0xff9900 })
      const s = new THREE.Mesh(geo, mat)
      s.userData.id = forcedId || THREE.MathUtils.generateUUID()
      s.position.copy(pos)
      scene.add(s)
      nodesRef.current.push(s)
      emitSceneChange()
      return s
    }
    addNodeRef.current = addNode

    function addFooting(nodeMesh, size, forcedId, offset, rotation) {
      const footingSize = size || { x: 1, y: 0.4, z: 1 }
      const off = offset || { x: 0, y: 0, z: 0 }
      const rot = rotation || { x: 0, y: 0, z: 0 }
      const geo = new THREE.BoxGeometry(footingSize.x, footingSize.y, footingSize.z)
      const mat = new THREE.MeshStandardMaterial({ color: 0x7f8ea3 })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.userData.id = forcedId || THREE.MathUtils.generateUUID()
      mesh.userData.type = 'footing'
      mesh.position.set(
        nodeMesh.position.x + off.x,
        nodeMesh.position.y - footingSize.y / 2 + off.y,
        nodeMesh.position.z + off.z
      )
      mesh.rotation.set(
        THREE.MathUtils.degToRad(rot.x || 0),
        THREE.MathUtils.degToRad(rot.y || 0),
        THREE.MathUtils.degToRad(rot.z || 0)
      )
      scene.add(mesh)
      footingsRef.current.push({
        id: mesh.userData.id,
        mesh,
        nodeId: nodeMesh.userData.id,
        size: footingSize,
        offset: off,
        rotation: rot,
      })
      emitSceneChange()
      addFootingRef.current = addFooting
      return { id: mesh.userData.id }
    }
    addFootingRef.current = addFooting

    function addMember(aNode, bNode, forcedId, offsetY) {
      const a = aNode.position.clone()
      const b = bNode.position.clone()
      const geom = new THREE.BufferGeometry().setFromPoints([a, b])
      const ln = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x333333 }))
      scene.add(ln)
      const m = {
        id: forcedId || THREE.MathUtils.generateUUID(),
        line: ln,
        aNode,
        bNode,
        offsetY: offsetY || 0,
        mesh: null,
        sectionDims: null,
        sectionMaterial: null,
        sectionAlign: null,
      }
      ln.userData = ln.userData || {}
      ln.userData.id = m.id
      membersRef.current.push(m)
      emitSceneChange()
      return m
    }
    addMemberRef.current = addMember

    function resolveLevelY(inputY) {
      if (!props.snapToLevel) return inputY
      const active = props.activeLevelId
        ? floors.find((f) => f.id === props.activeLevelId)
        : null
      if (active && typeof active.elevation === 'number') return active.elevation
      if (!floors.length) return inputY
      let best = floors[0]
      let bestDist = Math.abs((best.elevation || 0) - inputY)
      floors.forEach((f) => {
        const dist = Math.abs((f.elevation || 0) - inputY)
        if (dist < bestDist) {
          best = f
          bestDist = dist
        }
      })
      return typeof best.elevation === 'number' ? best.elevation : inputY
    }

    function applyMemberConstraint(pos, basePos) {
      if (!props.constrainMembers || !basePos) return pos
      const dx = Math.abs(pos.x - basePos.x)
      const dy = Math.abs(pos.y - basePos.y)
      const dz = Math.abs(pos.z - basePos.z)
      if (dy >= dx && dy >= dz) {
        pos.x = basePos.x
        pos.z = basePos.z
      } else {
        pos.y = basePos.y
      }
      return pos
    }

    function updateAttachedMembers(nodeMesh) {
      membersRef.current.forEach((m) => {
        if (m.aNode === nodeMesh || m.bNode === nodeMesh) {
          const pa = m.aNode.position
          const pb = m.bNode.position
          const off = m.offsetY || 0
          const arr = new Float32Array([pa.x, pa.y + off, pa.z, pb.x, pb.y + off, pb.z])
          m.line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3))
          m.line.geometry.attributes.position.needsUpdate = true
          m.line.geometry.computeBoundingSphere()
          if (m.mesh) {
            updateMemberMeshTransform(m)
          }
        }
      })
      emitSceneChange()
    }

    function updateAttachedFootings(nodeMesh) {
      footingsRef.current.forEach((f) => {
        if (f.nodeId !== nodeMesh.userData.id) return
        const size = f.size || { x: 1, y: 0.4, z: 1 }
        const off = f.offset || { x: 0, y: 0, z: 0 }
        f.mesh.position.set(
          nodeMesh.position.x + off.x,
          nodeMesh.position.y - size.y / 2 + off.y,
          nodeMesh.position.z + off.z
        )
      })
      emitSceneChange()
    }

    // --- Interaction ---
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    let dragging = false
    let dragTarget = null
    let dragStart = null

    function setMouseFromEvent(ev) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
    }

    function pickNode(ev) {
      setMouseFromEvent(ev)
      const objects = [
        ...nodesRef.current,
        ...membersRef.current.flatMap((m) => [m.line, m.mesh].filter(Boolean)),
        ...footingsRef.current.map((f) => f.mesh),
      ]
      const hits = raycaster.intersectObjects(objects, false)
      if (!hits || !hits.length) return null
      const obj = hits[0].object
      // check if it's a node
      const node = nodesRef.current.find(n=>n === obj)
      if (node) return { type: 'node', object: node }
      const member = membersRef.current.find(m=>m.line === obj)
      if (member) return { type: 'member', object: member }
      const memberMesh = membersRef.current.find((m) => m.mesh === obj)
      if (memberMesh) return { type: 'member', object: memberMesh }
      const footing = footingsRef.current.find(f=>f.mesh === obj)
      if (footing) return { type: 'footing', object: footing }
      return null
    }

    function intersectGround(ev) {
      setMouseFromEvent(ev)
      const hits = raycaster.intersectObject(plane, false)
      return hits?.length ? hits[0].point.clone() : null
    }

    function onDoubleClick(ev) {
      const point = intersectGround(ev)
      if (!point) return

      const pos = snapEnabled ? snapToGrid(point, gridSize) : point
      pos.y = resolveLevelY(pos.y)
      const basePos = selectedRef.current ? selectedRef.current.position : null
      if (tool === 'extrude' && basePos) {
        applyMemberConstraint(pos, basePos)
      }
      if (tool === 'extrude' && props.snapToLevel && selectedRef.current) {
        selectedRef.current.position.y = pos.y
        updateAttachedMembers(selectedRef.current)
        updateAttachedFootings(selectedRef.current)
      }
      const newNode = addNode(pos)

      if (tool === 'extrude' && selectedRef.current) {
        addMember(selectedRef.current, newNode)
      }

      if (selectedRef.current) {
        selectedRef.current.material?.emissive?.setHex?.(0x000000)
      }
      selectedRef.current = newNode
      setSelectedId(newNode.userData.id)
      newNode.material?.emissive?.setHex?.(0x222222)
    }

    function onPointerDown(ev) {
      if (ev.button === 1) {
        setRotateMode(true)
        return
      }
      if (rotateModeRef.current && ev.button === 0) {
        setRotateMode(false)
      }
      const hit = pickNode(ev)
      if (!hit) return

      if (hit.type === 'node') {
        const node = hit.object
        dragTarget = node
        dragging = true
        dragStart = node.position.clone()

        selectedMembersRef.current.clear()
        refreshMemberVisuals()
        if (selectedRef.current && selectedRef.current !== node) {
          selectedRef.current.material?.emissive?.setHex?.(0x000000)
        }
        if (selectedMemberRef.current) {
          selectedMemberRef.current.line.material &&
            selectedMemberRef.current.line.material.color.setHex(0x333333)
          selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
          selectedMemberRef.current = null
        }
        if (selectedFootingRef.current) {
          selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
          selectedFootingRef.current = null
        }
        selectedRef.current = node
        setSelectedId(node.userData.id)
        props.onSelectionChange && props.onSelectionChange({ type: 'node', id: node.userData.id })

        node.material?.emissive?.setHex?.(0x444444)
      } else if (hit.type === 'member') {
        // select member
        const member = hit.object
        const isMulti = !!ev.shiftKey
        if (selectedRef.current) {
          selectedRef.current.material?.emissive?.setHex?.(0x000000)
          selectedRef.current = null
        }
        if (!isMulti) {
          selectedMembersRef.current.clear()
        }
        if (selectedMemberRef.current && selectedMemberRef.current !== member) {
          selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
        }
        if (selectedFootingRef.current) {
          selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
          selectedFootingRef.current = null
        }
        selectedMemberRef.current = member
        setSelectedId(null)
        if (isMulti) {
          if (selectedMembersRef.current.has(member.id)) {
            selectedMembersRef.current.delete(member.id)
          } else {
            selectedMembersRef.current.add(member.id)
          }
          if (selectedMembersRef.current.size === 0) {
            selectedMemberRef.current = null
            props.onSelectionChange && props.onSelectionChange({ type: null, id: null })
            refreshMemberVisuals()
            return
          }
        } else {
          selectedMembersRef.current.add(member.id)
        }
        props.onSelectionChange && props.onSelectionChange({ type: 'member', id: member.id, multi: Array.from(selectedMembersRef.current) })
        refreshMemberVisuals()
      } else if (hit.type === 'footing') {
        const footing = hit.object
        selectedMembersRef.current.clear()
        refreshMemberVisuals()
        if (selectedRef.current) {
          selectedRef.current.material?.emissive?.setHex?.(0x000000)
          selectedRef.current = null
        }
        if (selectedMemberRef.current) {
          selectedMemberRef.current.line.material &&
            selectedMemberRef.current.line.material.color.setHex(0x333333)
          selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
          selectedMemberRef.current = null
        }
        if (selectedFootingRef.current && selectedFootingRef.current !== footing) {
          selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
        }
        selectedFootingRef.current = footing
        setSelectedId(null)
        props.onSelectionChange && props.onSelectionChange({ type: 'footing', id: footing.id })
        footing.mesh.material?.emissive?.setHex?.(0x222222)
      }
    }

    function onPointerMove(ev) {
      const point = intersectGround(ev)
      if (!point) return

      setMouseWorld({
        x: Number(point.x).toFixed(3),
        y: Number(point.y).toFixed(3),
        z: Number(point.z).toFixed(3),
      })

      const snapped = snapEnabled ? snapToGrid(point, gridSize) : point

      // show crosshair while dragging
      if (guideLinesRef.current) {
        const [gxx, gzz] = guideLinesRef.current
        const len = gridSize * gridDivisions
        gxx.geometry.setFromPoints([
          new THREE.Vector3(-len, snapped.y, snapped.z),
          new THREE.Vector3(len, snapped.y, snapped.z),
        ])
        gzz.geometry.setFromPoints([
          new THREE.Vector3(snapped.x, snapped.y, -len),
          new THREE.Vector3(snapped.x, snapped.y, len),
        ])
        gxx.visible = dragging
        gzz.visible = dragging
      }

      if (!dragging || !dragTarget) return

      let next = snapped.clone()
      if (props.axisLock === 'x' && dragStart) {
        next.y = dragStart.y
        next.z = dragStart.z
      } else if (props.axisLock === 'y' && dragStart) {
        next.x = dragStart.x
        next.z = dragStart.z
      } else if (props.axisLock === 'z' && dragStart) {
        next.x = dragStart.x
        next.y = dragStart.y
      }
      next.y = resolveLevelY(next.y)
      dragTarget.position.copy(next)
      updateAttachedMembers(dragTarget)
      updateAttachedFootings(dragTarget)
      props.onSceneChange && props.onSceneChange(nodesRef.current.map((n, i) => ({ index: i, id: n.userData.id, position: { x: n.position.x, y: n.position.y, z: n.position.z } })))
    }

    function onPointerUp() {
      if (dragging && dragTarget) {
        dragTarget.material?.emissive?.setHex?.(0x222222)
      }
      dragging = false
      dragTarget = null
      dragStart = null
    }

    function onKeyDown(ev){
      if (ev.key === 'Escape') {
        setRotateMode(false)
        if (selectedRef.current) {
          selectedRef.current.material?.emissive?.setHex?.(0x000000)
          selectedRef.current = null
        }
        if (selectedMemberRef.current) {
          selectedMemberRef.current.line.material &&
            selectedMemberRef.current.line.material.color.setHex(0x333333)
          selectedMemberRef.current.mesh?.material?.emissive?.setHex?.(0x000000)
          selectedMemberRef.current = null
        }
        if (selectedFootingRef.current) {
          selectedFootingRef.current.mesh.material?.emissive?.setHex?.(0x000000)
          selectedFootingRef.current = null
        }
        selectedMembersRef.current.clear()
        refreshMemberVisuals()
        setSelectedId(null)
        props.onSelectionChange && props.onSelectionChange({ type: null, id: null })
        return
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace'){
        if (selectedRef.current){
          const id = selectedRef.current.userData.id
          if (props.onRequestDelete){
            props.onRequestDelete({ type: 'node', id })
          } else {
            if (ref && ref.current && typeof ref.current.deleteNode === 'function'){
              ref.current.deleteNode(id)
            }
          }
        } else if (selectedMemberRef.current){
          const id = selectedMemberRef.current.id
          if (props.onRequestDelete){
            props.onRequestDelete({ type: 'member', id })
          } else {
            if (ref && ref.current && typeof ref.current.deleteMember === 'function'){
              ref.current.deleteMember(id)
              selectedMemberRef.current = null
            }
          }
        } else if (selectedFootingRef.current){
          const id = selectedFootingRef.current.id
          if (props.onRequestDelete){
            props.onRequestDelete({ type: 'footing', id })
          } else {
            if (ref && ref.current && typeof ref.current.deleteFooting === 'function'){
              ref.current.deleteFooting(id)
              selectedFootingRef.current = null
            }
          }
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)

    renderer.domElement.addEventListener('dblclick', onDoubleClick)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)

    function clearSceneObjects() {
      nodesRef.current.forEach((n) => n.parent && n.parent.remove(n))
      membersRef.current.forEach((m) => m.line.parent && m.line.parent.remove(m.line))
      membersRef.current.forEach((m) => m.mesh && m.mesh.parent && m.mesh.parent.remove(m.mesh))
      footingsRef.current.forEach((f) => f.mesh.parent && f.mesh.parent.remove(f.mesh))
      nodesRef.current = []
      membersRef.current = []
      footingsRef.current = []
      selectedMemberRef.current = null
      selectedFootingRef.current = null
      selectedRef.current = null
      selectedMembersRef.current.clear()
      setSelectedId(null)
    }

    function getMemberOffsetY(member, sectionsById) {
      if (!member || member.align !== 'top') return 0
      const section = member.sectionId && sectionsById ? sectionsById[member.sectionId] : null
      const h = section?.dims?.h
      return typeof h === 'number' ? h / 2 : 0
    }

    function getMemberSectionDims(section) {
      if (!section || !section.dims) return null
      const b = Number(section.dims.b)
      const h = Number(section.dims.h)
      if (!Number.isFinite(b) || !Number.isFinite(h) || b <= 0 || h <= 0) return null
      return { b, h }
    }

    function getWSectionDims(section) {
      if (!section || !section.aiscDims) return null
      const units = String(section.aiscUnits || section.units || '').toLowerCase()
      const scale = units === 'metric' ? 0.001 : 0.0254
      const d = Number(section.aiscDims.d) * scale
      const bf = Number(section.aiscDims.bf) * scale
      const tw = Number(section.aiscDims.tw) * scale
      const tf = Number(section.aiscDims.tf) * scale
      if (![d, bf, tw, tf].every((v) => Number.isFinite(v) && v > 0)) return null
      return { d, bf, tw, tf }
    }

    function parseFraction(value) {
      const s = String(value || '').trim()
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

    function parseHssThicknessFromLabel(label) {
      const parts = String(label || '').split('X')
      if (parts.length < 3) return NaN
      const last = parts[parts.length - 1]
      return parseFraction(last)
    }

    function getCSectionDims(section) {
      if (!section || !section.aiscDims) return null
      const units = String(section.aiscUnits || section.units || '').toLowerCase()
      const scale = units === 'metric' ? 0.001 : 0.0254
      const d = Number(section.aiscDims.d) * scale
      const bf = Number(section.aiscDims.bf) * scale
      const tw = Number(section.aiscDims.tw) * scale
      const tf = Number(section.aiscDims.tf) * scale
      if (![d, bf, tw, tf].every((v) => Number.isFinite(v) && v > 0)) return null
      return { d, bf, tw, tf }
    }

    function getLSectionDims(section) {
      if (!section || !section.aiscDims) return null
      const units = String(section.aiscUnits || section.units || '').toLowerCase()
      const scale = units === 'metric' ? 0.001 : 0.0254
      const d = Number(section.aiscDims.d) * scale
      const b = Number(section.aiscDims.b ?? section.aiscDims.bf) * scale
      const t = Number(section.aiscDims.t ?? section.aiscDims.tw ?? section.aiscDims.tf) * scale
      if (![d, b, t].every((v) => Number.isFinite(v) && v > 0)) return null
      return { d, b, t }
    }

    function getHssSectionDims(section) {
      if (!section || !section.aiscDims) return null
      const units = String(section.aiscUnits || section.units || '').toLowerCase()
      const scale = units === 'metric' ? 0.001 : 0.0254
      const h = Number(section.aiscDims.Ht ?? section.aiscDims.h ?? section.aiscDims.d) * scale
      const b = Number(section.aiscDims.B ?? section.aiscDims.b ?? section.aiscDims.bf) * scale
      let tRaw = section.aiscDims.t ?? section.aiscDims.tw ?? section.aiscDims.tf
      if (!tRaw) {
        tRaw = parseHssThicknessFromLabel(section.steelShape)
      }
      const t = Number(tRaw) * scale
      if (![h, b, t].every((v) => Number.isFinite(v) && v > 0)) return null
      if (t * 2 >= Math.min(h, b)) return null
      return { h, b, t }
    }

    function getWTSectionDims(section) {
      if (!section || !section.aiscDims) return null
      const units = String(section.aiscUnits || section.units || '').toLowerCase()
      const scale = units === 'metric' ? 0.001 : 0.0254
      const d = Number(section.aiscDims.d) * scale
      const bf = Number(section.aiscDims.bf) * scale
      const tw = Number(section.aiscDims.tw) * scale
      const tf = Number(section.aiscDims.tf) * scale
      if (![d, bf, tw, tf].every((v) => Number.isFinite(v) && v > 0)) return null
      return { d, bf, tw, tf }
    }

    function getPipeSectionDims(section) {
      if (!section || !section.aiscDims) return null
      const units = String(section.aiscUnits || section.units || '').toLowerCase()
      const scale = units === 'metric' ? 0.001 : 0.0254
      const od = Number(section.aiscDims.OD) * scale
      const id = Number(section.aiscDims.ID) * scale
      if (!Number.isFinite(od) || od <= 0) return null
      if (Number.isFinite(id) && id > 0 && id < od) return { od, id }
      return null
    }

    function get2LSectionDims(section) {
      const lDims = getLSectionDims(section)
      return lDims
    }

    function buildCSectionGeometry(dims) {
      const d = dims.d
      const bf = dims.bf
      const tw = dims.tw
      const tf = dims.tf
      const halfD = d / 2
      const halfB = bf / 2
      const shape = new THREE.Shape()
      shape.moveTo(-halfB, -halfD)
      shape.lineTo(halfB, -halfD)
      shape.lineTo(halfB, -halfD + tf)
      shape.lineTo(-halfB + tw, -halfD + tf)
      shape.lineTo(-halfB + tw, halfD - tf)
      shape.lineTo(halfB, halfD - tf)
      shape.lineTo(halfB, halfD)
      shape.lineTo(-halfB, halfD)
      shape.lineTo(-halfB, -halfD)
      const geom = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function buildLSectionGeometry(dims) {
      const d = dims.d
      const b = dims.b
      const t = dims.t
      const halfD = d / 2
      const halfB = b / 2
      const shape = new THREE.Shape()
      shape.moveTo(-halfB, -halfD)
      shape.lineTo(halfB, -halfD)
      shape.lineTo(halfB, -halfD + t)
      shape.lineTo(-halfB + t, -halfD + t)
      shape.lineTo(-halfB + t, halfD)
      shape.lineTo(-halfB, halfD)
      shape.lineTo(-halfB, -halfD)
      const geom = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function buildHssSectionGeometry(dims) {
      const h = dims.h
      const b = dims.b
      const t = dims.t
      const outer = new THREE.Shape()
      outer.moveTo(-b / 2, -h / 2)
      outer.lineTo(b / 2, -h / 2)
      outer.lineTo(b / 2, h / 2)
      outer.lineTo(-b / 2, h / 2)
      outer.lineTo(-b / 2, -h / 2)
      const hole = new THREE.Path()
      hole.moveTo(-b / 2 + t, -h / 2 + t)
      hole.lineTo(b / 2 - t, -h / 2 + t)
      hole.lineTo(b / 2 - t, h / 2 - t)
      hole.lineTo(-b / 2 + t, h / 2 - t)
      hole.lineTo(-b / 2 + t, -h / 2 + t)
      outer.holes.push(hole)
      const geom = new THREE.ExtrudeGeometry(outer, { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function buildTSectionGeometry(dims) {
      const d = dims.d
      const bf = dims.bf
      const tw = dims.tw
      const tf = dims.tf
      const halfD = d / 2
      const halfB = bf / 2
      const halfTw = tw / 2
      const shape = new THREE.Shape()
      shape.moveTo(-halfB, halfD)
      shape.lineTo(halfB, halfD)
      shape.lineTo(halfB, halfD - tf)
      shape.lineTo(halfTw, halfD - tf)
      shape.lineTo(halfTw, -halfD)
      shape.lineTo(-halfTw, -halfD)
      shape.lineTo(-halfTw, halfD - tf)
      shape.lineTo(-halfB, halfD - tf)
      shape.lineTo(-halfB, halfD)
      const geom = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function buildPipeSectionGeometry(dims) {
      const outer = new THREE.Shape()
      outer.absarc(0, 0, dims.od / 2, 0, Math.PI * 2, false)
      const hole = new THREE.Path()
      hole.absarc(0, 0, dims.id / 2, 0, Math.PI * 2, true)
      outer.holes.push(hole)
      const geom = new THREE.ExtrudeGeometry(outer, { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function build2LSectionGeometry(dims) {
      const d = dims.d
      const b = dims.b
      const t = dims.t
      const gap = t * 0.5
      const y0 = -d / 2
      const y1 = y0 + t
      const y2 = d / 2

      function angleShape(x0, dir) {
        const shape = new THREE.Shape()
        const x1 = x0 + dir * b
        const x2 = x0 + dir * t
        shape.moveTo(x0, y0)
        shape.lineTo(x1, y0)
        shape.lineTo(x1, y1)
        shape.lineTo(x2, y1)
        shape.lineTo(x2, y2)
        shape.lineTo(x0, y2)
        shape.lineTo(x0, y0)
        return shape
      }

      const left = angleShape(-gap / 2, -1)
      const right = angleShape(gap / 2, 1)
      const geom = new THREE.ExtrudeGeometry([left, right], { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function buildWSectionGeometry(dims) {
      const d = dims.d
      const bf = dims.bf
      const tw = dims.tw
      const tf = dims.tf
      const halfD = d / 2
      const halfB = bf / 2
      const halfTw = tw / 2
      const yTop = halfD
      const yBot = -halfD
      const yFlangeTop = halfD - tf
      const yFlangeBot = -halfD + tf
      const shape = new THREE.Shape()
      shape.moveTo(-halfB, yTop)
      shape.lineTo(halfB, yTop)
      shape.lineTo(halfB, yFlangeTop)
      shape.lineTo(halfTw, yFlangeTop)
      shape.lineTo(halfTw, yFlangeBot)
      shape.lineTo(halfB, yFlangeBot)
      shape.lineTo(halfB, yBot)
      shape.lineTo(-halfB, yBot)
      shape.lineTo(-halfB, yFlangeBot)
      shape.lineTo(-halfTw, yFlangeBot)
      shape.lineTo(-halfTw, yFlangeTop)
      shape.lineTo(-halfB, yFlangeTop)
      shape.lineTo(-halfB, yTop)
      const geom = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
      geom.rotateY(Math.PI / 2)
      geom.translate(-0.5, 0, 0)
      return geom
    }

    function updateMemberMeshTransform(m) {
      if (!m.mesh || !m.sectionDims) return
      const off = m.offsetY || 0
      const a = m.aNode.position.clone()
      const b = m.bNode.position.clone()
      a.y += off
      b.y += off
      const dir = b.clone().sub(a)
      const len = dir.length()
      if (len <= 0.0001) return
      const mid = a.clone().add(b).multiplyScalar(0.5)
      m.mesh.position.copy(mid)
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        dir.normalize()
      )
      m.mesh.setRotationFromQuaternion(quat)
      if (m.mesh.userData && m.mesh.userData.baseLen === 1) {
        m.mesh.scale.set(len, 1, 1)
      }
    }

    function updateMemberMeshes(model, sectionsById) {
      if (!model) return
      const membersById = Object.fromEntries((model.members || []).map((m) => [m.id, m]))
      membersRef.current.forEach((m) => {
        const meta = membersById[m.id]
        const section = meta?.sectionId ? sectionsById[meta.sectionId] : null
        const dims = getMemberSectionDims(section)
        const preview = meta?.preview || 'shape'
        if (!dims || preview === 'line') {
          if (m.mesh) m.mesh.visible = false
          m.line.visible = true
          m.sectionDims = null
          return
        }
        let wDims = null
        let cDims = null
        let lDims = null
        let hssDims = null
        let wtDims = null
        let pipeDims = null
        let twoLDims = null
        if (section?.material === 'steel') {
          if (section.steelType === 'W') wDims = getWSectionDims(section)
          if (section.steelType === 'C') cDims = getCSectionDims(section)
          if (section.steelType === 'L') lDims = getLSectionDims(section)
          if (section.steelType === 'HSS') hssDims = getHssSectionDims(section)
          if (section.steelType === 'WT') wtDims = getWTSectionDims(section)
          if (section.steelType === 'PIPE') pipeDims = getPipeSectionDims(section)
          if (section.steelType === '2L') twoLDims = get2LSectionDims(section)
        }
        const materialKey = section?.material || 'rc'
        const profileKey = wDims
          ? `${materialKey}:w:${wDims.d.toFixed(6)}:${wDims.bf.toFixed(6)}:${wDims.tw.toFixed(6)}:${wDims.tf.toFixed(6)}`
          : cDims
            ? `${materialKey}:c:${cDims.d.toFixed(6)}:${cDims.bf.toFixed(6)}:${cDims.tw.toFixed(6)}:${cDims.tf.toFixed(6)}`
            : lDims
              ? `${materialKey}:l:${lDims.d.toFixed(6)}:${lDims.b.toFixed(6)}:${lDims.t.toFixed(6)}`
              : hssDims
                ? `${materialKey}:hss:${hssDims.h.toFixed(6)}:${hssDims.b.toFixed(6)}:${hssDims.t.toFixed(6)}`
                : wtDims
                  ? `${materialKey}:wt:${wtDims.d.toFixed(6)}:${wtDims.bf.toFixed(6)}:${wtDims.tw.toFixed(6)}:${wtDims.tf.toFixed(6)}`
                  : pipeDims
                    ? `${materialKey}:pipe:${pipeDims.od.toFixed(6)}:${pipeDims.id.toFixed(6)}`
                    : twoLDims
                      ? `${materialKey}:2l:${twoLDims.d.toFixed(6)}:${twoLDims.b.toFixed(6)}:${twoLDims.t.toFixed(6)}`
                      : `${materialKey}:box:${dims.b.toFixed(6)}:${dims.h.toFixed(6)}`
        if (!m.mesh) {
          const mat = new THREE.MeshStandardMaterial({
            color: section.material === 'steel' ? 0x5b6777 : 0x8b9bb0,
          })
          let geom = null
          if (wDims) geom = buildWSectionGeometry(wDims)
          else if (cDims) geom = buildCSectionGeometry(cDims)
          else if (lDims) geom = buildLSectionGeometry(lDims)
          else if (hssDims) geom = buildHssSectionGeometry(hssDims)
          else if (wtDims) geom = buildTSectionGeometry(wtDims)
          else if (pipeDims) geom = buildPipeSectionGeometry(pipeDims)
          else if (twoLDims) geom = build2LSectionGeometry(twoLDims)
          else geom = new THREE.BoxGeometry(1, dims.h, dims.b)
          m.mesh = new THREE.Mesh(geom, mat)
          m.mesh.userData = { baseLen: 1, profileKey }
          scene.add(m.mesh)
        } else if (!m.mesh.userData || m.mesh.userData.profileKey !== profileKey) {
          m.mesh.geometry.dispose()
          let geom = null
          if (wDims) geom = buildWSectionGeometry(wDims)
          else if (cDims) geom = buildCSectionGeometry(cDims)
          else if (lDims) geom = buildLSectionGeometry(lDims)
          else if (hssDims) geom = buildHssSectionGeometry(hssDims)
          else if (wtDims) geom = buildTSectionGeometry(wtDims)
          else if (pipeDims) geom = buildPipeSectionGeometry(pipeDims)
          else if (twoLDims) geom = build2LSectionGeometry(twoLDims)
          else geom = new THREE.BoxGeometry(1, dims.h, dims.b)
          m.mesh.geometry = geom
          m.mesh.userData = { baseLen: 1, profileKey }
          m.mesh.material && (m.mesh.material.color.set(section.material === 'steel' ? 0x5b6777 : 0x8b9bb0))
        }
        m.mesh.visible = true
        m.line.visible = false
        m.sectionDims = dims
        m.offsetY = getMemberOffsetY(meta, sectionsById)
        updateMemberMeshTransform(m)
      })
      refreshMemberVisuals()
    }
    function loadModel(model) {
      clearSceneObjects()
      if (!model) return
      selectedMembersRef.current.clear()
      const sectionsById = Object.fromEntries(((props.sections || model.sections) || []).map((s) => [s.id, s]))
      const nodesById = {}
      const nodeList = Array.isArray(model.nodes) ? model.nodes : []
      nodeList.forEach((n) => {
        if (!n || !n.position) return
        const pos = new THREE.Vector3(n.position.x, n.position.y, n.position.z)
        const mesh = addNode(pos, n.id)
        nodesById[n.id] = mesh
      })
      const memberList = Array.isArray(model.members) ? model.members : []
      memberList.forEach((m) => {
        const a = nodesById[m.a]
        const b = nodesById[m.b]
        if (a && b) addMember(a, b, m.id, getMemberOffsetY(m, sectionsById))
      })
      const footingList = Array.isArray(model.footings) ? model.footings : []
      footingList.forEach((f) => {
        const node = nodesById[f.nodeId]
        if (node) addFooting(node, f.size, f.id, f.offset, f.rotation)
      })
      updateMemberMeshes(model, sectionsById)
      if (model.selection && model.selection.id) {
        if (model.selection.type === 'node') {
          const selectedNode = nodesById[model.selection.id]
          if (selectedNode) {
            if (selectedRef.current && selectedRef.current !== selectedNode) {
              selectedRef.current.material?.emissive?.setHex?.(0x000000)
            }
            selectedRef.current = selectedNode
            setSelectedId(selectedNode.userData.id)
            selectedNode.material?.emissive?.setHex?.(0x222222)
          }
        } else if (model.selection.type === 'member') {
          const selectedMember = membersRef.current.find((m) => m.id === model.selection.id)
          if (selectedMember) {
            selectedMemberRef.current = selectedMember
            selectedMembersRef.current.add(selectedMember.id)
            setSelectedId(null)
            refreshMemberVisuals()
          }
        } else if (model.selection.type === 'footing') {
          const selectedFooting = footingsRef.current.find((f) => f.id === model.selection.id)
          if (selectedFooting) {
            selectedFootingRef.current = selectedFooting
            setSelectedId(null)
            selectedFooting.mesh.material?.emissive?.setHex?.(0x222222)
          }
        }
      }
      emitSceneChange()
    }

    function updateMemberOffsets(model) {
      if (!model) return
      const sectionsById = Object.fromEntries(((props.sections || model.sections) || []).map((s) => [s.id, s]))
      const membersById = Object.fromEntries((model.members || []).map((m) => [m.id, m]))
      membersRef.current.forEach((m) => {
        const meta = membersById[m.id]
        const offsetY = getMemberOffsetY(meta, sectionsById)
        m.offsetY = offsetY
        const pa = m.aNode.position
        const pb = m.bNode.position
        const arr = new Float32Array([pa.x, pa.y + offsetY, pa.z, pb.x, pb.y + offsetY, pb.z])
        m.line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3))
        m.line.geometry.attributes.position.needsUpdate = true
        m.line.geometry.computeBoundingSphere()
      })
      updateMemberMeshes(model, sectionsById)
    }

    loadModelRef.current = loadModel
    updateMemberOffsetsRef.current = updateMemberOffsets
    if (props.model) {
      loadModel(props.model)
    } else if (props.initialModel) {
      loadModel(props.initialModel)
    }

    // --- Resize ---
    function onResize() {
      const w = el.clientWidth || 800
      const h = el.clientHeight || 600
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    // --- Render loop ---
    let rafId = 0
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      controls.update()

      // rulers (simple projected ticks)
      if (rulerTopRef.current) {
        const w = el.clientWidth || 800
        let html = ''
        for (let i = -4; i <= 4; i++) {
          const worldX = i * gridSize * 2
          const vec = new THREE.Vector3(worldX, 0, 0).project(camera)
          const left = Math.round((vec.x * 0.5 + 0.5) * w)
          html += `<div style="position:absolute; left:${left}px; top:0; transform:translateX(-50%); font-size:11px; color:#333">${worldX.toFixed(
            1
          )}</div>`
        }
        rulerTopRef.current.innerHTML = html
      }
      if (rulerLeftRef.current) {
        const h = el.clientHeight || 600
        let html = ''
        for (let i = -4; i <= 4; i++) {
          const worldZ = i * gridSize * 2
          const vec = new THREE.Vector3(0, 0, worldZ).project(camera)
          const top = Math.round((-vec.y * 0.5 + 0.5) * h)
          html += `<div style="position:absolute; top:${top}px; left:0; transform:translateY(-50%); font-size:11px; color:#333">${worldZ.toFixed(
            1
          )}</div>`
        }
        rulerLeftRef.current.innerHTML = html
      }

      renderer.render(scene, camera)
    }
    animate()

    // --- Cleanup ---
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)

      renderer.domElement.removeEventListener('dblclick', onDoubleClick)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)

      controls.dispose()
      renderer.dispose()

      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement)
    }
  }, [snapEnabled, gridSize, gridDivisions, tool, props.floors, props.nglElevation, props.showVerticalGrid, props.snapToLevel, props.activeLevelId, props.axisLock, props.constrainMembers, props.sections])

  useEffect(() => {
    if (props.model && updateMemberOffsetsRef.current) {
      updateMemberOffsetsRef.current(props.model)
    }
  }, [props.model])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Rulers */}
      <div
        ref={rulerTopRef}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 28,
          pointerEvents: 'none',
        }}
      />
      <div
        ref={rulerLeftRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 36,
          pointerEvents: 'none',
        }}
      />

      {/* Coords */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          background: 'rgba(255,255,255,0.95)',
          padding: '6px 10px',
          borderRadius: 6,
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Coords</div>
        <div>
          X: {mouseWorld.x} &nbsp; Y: {mouseWorld.y} &nbsp; Z: {mouseWorld.z}
        </div>
      </div>

      {/* Tool + selection */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          background: 'rgba(255,255,255,0.95)',
          padding: 8,
          borderRadius: 6,
          boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <button
            onClick={() => setTool('select')}
            style={{
              marginRight: 6,
              padding: '6px 8px',
              background: tool === 'select' ? '#0b5fff' : '#eee',
              color: tool === 'select' ? '#fff' : '#222',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Select
          </button>
          <button
            onClick={() => setTool('extrude')}
            style={{
              padding: '6px 8px',
              background: tool === 'extrude' ? '#0b5fff' : '#eee',
              color: tool === 'extrude' ? '#fff' : '#222',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Extrude
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#333' }}>Tool: {tool}</div>
        <div style={{ fontSize: 12, color: '#333', marginTop: 8 }}>
          Selected: {selectedId || 'none'}
        </div>
      </div>

      {/* Grid controls */}
      <div
        style={{
          position: 'absolute',
          left: 12,
          top: 12,
          background: 'rgba(255,255,255,0.9)',
          padding: 8,
          borderRadius: 6,
          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 12 }}>Snap to grid</label>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
        </div>
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 12 }}>Grid size</label>
          <input
            type="number"
            step="0.1"
            value={gridSize}
            onChange={(e) => setGridSize(Number(e.target.value) || 0.1)}
            style={{ width: 80 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12 }}>Divisions</label>
          <input
            type="number"
            value={gridDivisions}
            onChange={(e) => setGridDivisions(Number(e.target.value) || 10)}
            style={{ width: 80 }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#444', marginTop: 6 }}>
          Double-click on ground to place nodes (snaps when enabled)
        </div>
      </div>
    </div>
  )
})

export default ThreeScene
    function setRotateMode(enabled) {
      rotateModeRef.current = enabled
      controls.enableRotate = enabled
      renderer.domElement.style.cursor = enabled ? 'grab' : 'default'
    }
