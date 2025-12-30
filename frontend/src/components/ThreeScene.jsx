import React, {
  useRef,
  useState,
  useEffect,
  useImperativeHandle,
  forwardRef,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import computeLCS from '../utils/lcs' // keep if you have it; safe-guarded with try/catch below

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
  const selectedRef = useRef(null)
  const addNodeRef = useRef(null)
  const addMemberRef = useRef(null)

  const [selectedId, setSelectedId] = useState(null)
  const [tool, setTool] = useState('select') // 'select' | 'extrude'
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0, z: 0 })

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

      if (selectedRef.current && selectedRef.current !== found) {
        selectedRef.current.material?.emissive?.setHex?.(0x000000)
      }
      selectedRef.current = found
      setSelectedId(found.userData.id)
      found.material?.emissive?.setHex?.(0x222222)
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
      // remove node
      node.parent && node.parent.remove(node)
      nodesRef.current.splice(idx, 1)
      if (selectedRef.current === node) selectedRef.current = null
      setSelectedId(null)
      emitSceneChange()
      return true
    },
    deleteMember: (memberId) => {
      const mi = membersRef.current.findIndex((m) => m.id === memberId)
      if (mi === -1) return false
      const m = membersRef.current[mi]
      m.line.parent && m.line.parent.remove(m.line)
      membersRef.current.splice(mi, 1)
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
    }
  }))

    // helper to emit full scene snapshot
    function emitSceneChange(){
      const nodes = nodesRef.current.map((n, i) => ({ index: i, id: n.userData.id, position: { x: n.position.x, y: n.position.y, z: n.position.z } }))
      const members = membersRef.current.map(m => ({ id: m.id, a: m.aNode.userData.id, b: m.bNode.userData.id }))
      props.onSceneChange && props.onSceneChange({ nodes, members })
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

    // Optional demo member + LCS axes
    try {
      const p1 = new THREE.Vector3(0, 0, 0)
      const p2 = new THREE.Vector3(4, 0, 2)
      const demoLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([p1, p2]),
        new THREE.LineBasicMaterial({ color: 0x0b5fff })
      )
      scene.add(demoLine)

      const lcs = computeLCS(p1, p2, 30)
      const origin = p1.clone()
      const axisLen = 1.2
      scene.add(
        new THREE.ArrowHelper(lcs.x, origin, axisLen, 0xff0000),
        new THREE.ArrowHelper(lcs.y, origin, axisLen, 0x00ff00),
        new THREE.ArrowHelper(lcs.z, origin, axisLen, 0x0000ff)
      )
    } catch (_) {
      // ignore if computeLCS not available/throws
    }

    // --- Helpers ---
    function addNode(pos) {
      const geo = new THREE.SphereGeometry(0.12, 12, 12)
      const mat = new THREE.MeshStandardMaterial({ color: 0xff9900 })
      const s = new THREE.Mesh(geo, mat)
      s.userData.id = THREE.MathUtils.generateUUID()
      s.position.copy(pos)
      scene.add(s)
      nodesRef.current.push(s)
      emitSceneChange()
      addNodeRef.current = addNode
      return s
    }

    function addMember(aNode, bNode) {
      const a = aNode.position.clone()
      const b = bNode.position.clone()
      const geom = new THREE.BufferGeometry().setFromPoints([a, b])
      const ln = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0x333333 }))
      scene.add(ln)
      const m = { id: THREE.MathUtils.generateUUID(), line: ln, aNode, bNode }
      ln.userData = ln.userData || {}
      ln.userData.id = m.id
      membersRef.current.push(m)
      emitSceneChange()
      addMemberRef.current = addMember
      return m
    }

    function updateAttachedMembers(nodeMesh) {
      membersRef.current.forEach((m) => {
        if (m.aNode === nodeMesh || m.bNode === nodeMesh) {
          const pa = m.aNode.position
          const pb = m.bNode.position
          const arr = new Float32Array([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z])
          m.line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3))
          m.line.geometry.attributes.position.needsUpdate = true
          m.line.geometry.computeBoundingSphere()
        }
      })
      emitSceneChange()
    }

    // --- Interaction ---
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    let dragging = false
    let dragTarget = null
    let selectedMember = null

    function setMouseFromEvent(ev) {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)
    }

    function pickNode(ev) {
      setMouseFromEvent(ev)
      const objects = [...nodesRef.current, ...membersRef.current.map(m=>m.line)]
      const hits = raycaster.intersectObjects(objects, false)
      if (!hits || !hits.length) return null
      const obj = hits[0].object
      // check if it's a node
      const node = nodesRef.current.find(n=>n === obj)
      if (node) return { type: 'node', object: node }
      const member = membersRef.current.find(m=>m.line === obj)
      if (member) return { type: 'member', object: member }
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
      const hit = pickNode(ev)
      if (!hit) return

      if (hit.type === 'node') {
        const node = hit.object
        dragTarget = node
        dragging = true

        if (selectedRef.current && selectedRef.current !== node) {
          selectedRef.current.material?.emissive?.setHex?.(0x000000)
        }
        selectedRef.current = node
        selectedMember = null
        setSelectedId(node.userData.id)

        node.material?.emissive?.setHex?.(0x444444)
      } else if (hit.type === 'member') {
        // select member
        const member = hit.object
        if (selectedRef.current) {
          selectedRef.current.material?.emissive?.setHex?.(0x000000)
          selectedRef.current = null
        }
        selectedMember = member
        setSelectedId(null)
        // highlight member
        member.line.material && (member.line.material.color.setHex(0xff0000))
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

      dragTarget.position.copy(snapped)
      updateAttachedMembers(dragTarget)
      props.onSceneChange && props.onSceneChange(nodesRef.current.map((n, i) => ({ index: i, id: n.userData.id, position: { x: n.position.x, y: n.position.y, z: n.position.z } })))
    }

    function onPointerUp() {
      if (dragging && dragTarget) {
        dragTarget.material?.emissive?.setHex?.(0x222222)
      }
      dragging = false
      dragTarget = null
    }

    function onKeyDown(ev){
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
        } else if (selectedMember){
          const id = selectedMember.id
          if (props.onRequestDelete){
            props.onRequestDelete({ type: 'member', id })
          } else {
            if (ref && ref.current && typeof ref.current.deleteMember === 'function'){
              ref.current.deleteMember(id)
              selectedMember = null
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
  }, [snapEnabled, gridSize, gridDivisions, tool])

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
          Selected: {selectedId || '—'}
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
