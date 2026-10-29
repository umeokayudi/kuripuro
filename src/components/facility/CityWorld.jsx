import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { AREA_KINDS } from '../../lib/facilityModel'
import { renderGate } from './world/renderGate'

/**
 * Mundo Kuripuro: todas as lojas como uma cidadezinha em 3D (estilo jogo).
 * Cada loja é uma maquete da planta real (áreas coloridas, paredes baixas, equipamentos pintados pela situação)
 * num lote; em cima flutua um marcador vermelho/amarelo/verde. Tocar no lote voa até ele e chama onPick(id).
 * stores: [{ id, name, sub, layout (térreo), levels, status, late, soon, draft }]
 */

const PLOT = 10
const GAP = 4
const FIT = 7.4
const WALL_H = 0.55
const COLORS = { overdue: '#ef4444', due: '#f59e0b', ok: '#22c55e', none: '#94a3b8', draft: '#64748b' }

const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

function gridPos(i, n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.ceil(n / cols)
  const step = PLOT + GAP
  const c = i % cols
  const r = Math.floor(i / cols)
  return { x: (c - (cols - 1) / 2) * step, z: (r - (rows - 1) / 2) * step, span: Math.max(cols, rows) * step }
}

function roundedPlot(w, d, r) {
  const s = new THREE.Shape()
  const x = -w / 2, y = -d / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 })
  g.rotateX(-Math.PI / 2)
  return g
}

/** Maquete de uma loja centrada na origem, cabendo em FIT × FIT. */
function buildModel(store, mats) {
  const g = new THREE.Group()
  const L = store.layout || { width: 10, depth: 8, areas: [], walls: [], elements: [] }
  const W = Math.max(2, L.width || 10)
  const D = Math.max(2, L.depth || 8)
  const s = FIT / Math.max(W, D)
  const ox = -W / 2, oz = -D / 2
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W * s, 0.08, D * s), mats.floor)
  floor.position.y = 0.04
  floor.receiveShadow = true
  g.add(floor)
  for (const a of L.areas || []) {
    const color = (AREA_KINDS[a.kind] || AREA_KINDS.other).color
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.05, a.w * s - 0.06), 0.05, Math.max(0.05, a.d * s - 0.06)),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45), roughness: 0.85 }))
    m.position.set((ox + a.x + a.w / 2) * s, 0.1, (oz + a.y + a.d / 2) * s)
    m.receiveShadow = true
    g.add(m)
  }
  for (const w of L.walls || []) {
    const dx = (w.x2 - w.x1) * s, dz = (w.y2 - w.y1) * s
    const len = Math.hypot(dx, dz)
    if (len < 0.05) continue
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, 0.09), w.kind === 'window' ? mats.glass : mats.wall)
    m.position.set((ox + (w.x1 + w.x2) / 2) * s, 0.08 + WALL_H / 2, (oz + (w.y1 + w.y2) / 2) * s)
    m.rotation.y = -Math.atan2(dz, dx)
    m.castShadow = true
    g.add(m)
  }
  const st = store.elStatus || new Map()
  for (const el of L.elements || []) {
    const h = Math.min(0.5, Math.max(0.12, (el.h || 0.8) * s * 0.6))
    const c = COLORS[st.get(el.id)] || '#e2e8f0'
    const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.08, (el.w || 0.6) * s), h, Math.max(0.08, (el.d || 0.6) * s)),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, emissive: st.get(el.id) === 'overdue' ? '#7f1d1d' : '#000000', emissiveIntensity: 0.6 }))
    m.position.set((ox + (el.x || 0) + (el.w || 0.6) / 2) * s, 0.12 + h / 2, (oz + (el.y || 0) + (el.d || 0.6) / 2) * s)
    m.rotation.y = -((el.rotation || 0) * Math.PI) / 180
    m.castShadow = true
    g.add(m)
  }
  // andares de cima: lajes translúcidas empilhadas
  for (let i = 1; i < (store.levels || 1); i++) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W * s, 0.06, D * s), mats.upper)
    slab.position.y = 0.1 + i * 1.1
    g.add(slab)
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W * s, 1.1, D * s)), mats.edge)
    edges.position.y = 0.1 + i * 1.1 - 0.55
    g.add(edges)
  }
  if (store.draft) g.traverse(o => { if (o.material && o.material.transparent !== true) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45 } })
  return g
}

function beacon(color) {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.3 })
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), mat)
  gem.castShadow = true
  g.add(gem)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }))
  ring.rotation.x = Math.PI / 2
  g.add(ring)
  return g
}

export default function CityWorld({ stores = [], height = 600, focusId = null, onPick, onFail, labels = {}, rightInset = 0 }) {
  const hostRef = useRef(null)
  const ctxRef = useRef(null)
  const labelRefs = useRef(new Map())
  const pickRef = useRef(onPick)
  const insetRef = useRef(rightInset)
  insetRef.current = rightInset
  const [failed, setFailed] = useState(false)
  const [hover, setHover] = useState(null)
  pickRef.current = onPick
  useEffect(() => { ctxRef.current?.poke?.() })

  // renderer + laço (uma vez)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch {
      setFailed(true)
      onFail?.()
      return
    }
    renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // buildings do not move: shadows are drawn again only when the city is rebuilt
    renderer.shadowMap.autoUpdate = false
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0b1a2e')
    scene.fog = new THREE.Fog('#0b1a2e', 60, 160)
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.5

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.42
    controls.minPolarAngle = Math.PI * 0.12
    controls.minDistance = 8
    controls.maxDistance = 140
    // v1.0.102 · no endless auto-rotation: the city stands still until someone moves it
    controls.autoRotate = false
    controls.screenSpacePanning = false
    controls.addEventListener('start', () => { controls.autoRotate = false })

    scene.add(new THREE.HemisphereLight('#dbeafe', '#1e293b', 0.9))
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    sun.shadow.bias = -0.0005
    scene.add(sun, sun.target)

    const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 64), new THREE.MeshStandardMaterial({ color: '#16283f', roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const city = new THREE.Group()
    scene.add(city)
    const mats = {
      floor: new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.9 }),
      wall: new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: '#7dd3fc', roughness: 0.1, transparent: true, opacity: 0.5 }),
      upper: new THREE.MeshStandardMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.28, depthWrite: false }),
      edge: new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.6 }),
      plot: new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.8 }),
      plotHover: new THREE.MeshStandardMaterial({ color: '#3b82f6', roughness: 0.6, emissive: '#1d4ed8', emissiveIntensity: 0.35 }),
      road: new THREE.MeshStandardMaterial({ color: '#0f1d30', roughness: 1 }),
      dash: new THREE.MeshBasicMaterial({ color: '#475569' }),
    }
    const raycaster = new THREE.Raycaster()
    const ctx = { renderer, scene, camera, controls, city, sun, mats, plots: new Map(), beacons: [], fly: null, span: 30 }
    ctxRef.current = ctx
    if (import.meta.env.DEV) window.__cityWorld = ctx

    const resize = () => {
      const w = host.clientWidth || 600
      const h = host.clientHeight || 400
      renderer.setSize(w, h)
      ctx.poke?.()
      camera.aspect = w / h
      // painel de missões à direita: o centro da cidade fica no meio do espaço livre
      const inset = Math.min(insetRef.current, w * 0.4)
      if (inset > 0) camera.setViewOffset(w + inset, h, inset, 0, w, h)
      else camera.clearViewOffset()
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    // toque: arrastar gira, toque parado escolhe a loja
    const down = { x: 0, y: 0, t: 0 }
    const ndc = e => {
      const r = renderer.domElement.getBoundingClientRect()
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    }
    const hit = e => {
      raycaster.setFromCamera(ndc(e), camera)
      const targets = [...ctx.plots.values()].map(p => p.hitbox)
      const h = raycaster.intersectObjects(targets, false)[0]
      return h ? h.object.userData.id : null
    }
    const onDown = e => { down.x = e.clientX; down.y = e.clientY; down.t = performance.now() }
    const onUp = e => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 || performance.now() - down.t > 600) return
      const id = hit(e)
      if (id) flyTo(id, true)
    }
    const onMove = e => {
      if (e.pointerType !== 'mouse') return
      const id = hit(e)
      renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
      setHover(h => (h === id ? h : id))
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)

    const flyTo = (id, enter) => {
      const p = ctx.plots.get(id)
      if (!p) return
      controls.autoRotate = false
      const to = p.group.position.clone()
      const dir = camera.position.clone().sub(controls.target).setY(0).normalize()
      if (!dir.lengthSq()) dir.set(0, 0, 1)
      ctx.fly = {
        t0: performance.now(), dur: enter ? 750 : 900,
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(),
        toTarget: to.clone(), toPos: to.clone().add(dir.multiplyScalar(enter ? 7 : 16)).setY(enter ? 6.5 : 13),
        done: enter ? () => pickRef.current?.(id) : null,
      }
      ctx.poke?.()
    }
    ctx.flyTo = flyTo
    ctx.resize = resize

    const gate = renderGate(host)
    ctx.poke = gate.poke
    controls.addEventListener('change', gate.poke)
    const v = new THREE.Vector3()
    let raf = 0
    const loop = () => {
      raf = 0
      if (!gate.active()) return
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      if (!gate.shouldDraw(now, !!ctx.fly)) return
      if (ctx.fly) {
        const f = ctx.fly
        const k = Math.min(1, (now - f.t0) / f.dur)
        const e = ease(k)
        camera.position.lerpVectors(f.fromPos, f.toPos, e)
        controls.target.lerpVectors(f.fromTarget, f.toTarget, e)
        if (k >= 1) { ctx.fly = null; f.done?.() }
      }
      controls.update()
      const tt = now / 1000
      ctx.beacons.forEach((b, i) => {
        b.position.y = b.userData.baseY + Math.sin(tt * 2 + i) * 0.25
        b.rotation.y = tt * 1.2 + i
        const ring = b.children[1]
        if (ring) { const sc = 1 + ((tt * 0.8 + i * 0.3) % 1) * 0.8; ring.scale.set(sc, sc, sc); ring.material.opacity = 0.6 * (1 - ((tt * 0.8 + i * 0.3) % 1)) }
      })
      renderer.render(scene, camera)
      // etiquetas HTML acompanham os prédios
      const w = renderer.domElement.clientWidth
      const h = renderer.domElement.clientHeight
      ctx.plots.forEach((p, id) => {
        const el = labelRefs.current.get(id)
        if (!el) return
        v.copy(p.group.position).setY(p.labelY)
        v.project(camera)
        const behind = v.z > 1
        const dist = camera.position.distanceTo(p.group.position)
        el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * w}px,${((1 - v.y) / 2) * h}px)`
        el.style.opacity = behind ? '0' : String(Math.max(0, Math.min(1, (110 - dist) / 40)))
        el.style.zIndex = String(1000 - Math.round(dist))
      })
    }
    gate.onResume = () => { if (!raf) loop() }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      gate.dispose()
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      controls.dispose()
      scene.traverse(o => { o.geometry?.dispose?.() })
      renderer.dispose()
      renderer.domElement.remove()
      ctxRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // monta a cidade quando as lojas mudam (por conteúdo)
  const key = JSON.stringify(stores.map(s => [s.id, s.status, s.late, s.soon, s.levels, s.draft, s.layout?.width, s.layout?.depth, s.layout?.elements?.length, s.layout?.areas?.length, s.layout?.walls?.length, [...(s.elStatus || new Map())]]))
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { city, mats, sun, camera, controls } = ctx
    city.children.slice().forEach(c => { city.remove(c); c.traverse(o => o.geometry?.dispose?.()) })
    ctx.plots.clear()
    ctx.beacons = []
    const n = stores.length
    let span = PLOT
    stores.forEach((s, i) => {
      const pos = gridPos(i, n)
      span = pos.span
      const group = new THREE.Group()
      group.position.set(pos.x, 0, pos.z)
      const plot = new THREE.Mesh(roundedPlot(PLOT, PLOT, 0.9), mats.plot)
      plot.receiveShadow = true
      group.add(plot)
      const model = buildModel(s, mats)
      model.position.y = 0.41
      group.add(model)
      const top = 0.41 + 0.6 + Math.max(0, (s.levels || 1) - 1) * 1.1
      const color = COLORS[s.draft ? 'draft' : s.status] || COLORS.none
      if (!s.draft && (s.status === 'overdue' || s.status === 'due' || s.status === 'ok')) {
        const b = beacon(color)
        b.userData.baseY = top + 2.2
        b.position.y = b.userData.baseY
        if (s.status === 'ok') b.scale.setScalar(0.6)
        group.add(b)
        ctx.beacons.push(b)
      }
      const hitbox = new THREE.Mesh(new THREE.BoxGeometry(PLOT, 3, PLOT), new THREE.MeshBasicMaterial({ visible: false }))
      hitbox.position.y = 1.5
      hitbox.userData.id = s.id
      group.add(hitbox)
      city.add(group)
      ctx.plots.set(s.id, { group, plot, hitbox, labelY: top + 3.6 })
    })
    // ruas entre os lotes
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
    const rows = Math.max(1, Math.ceil(n / cols))
    const step = PLOT + GAP
    for (let c = 0; c <= cols; c++) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(GAP * 0.8, rows * step + GAP), mats.road)
      road.rotation.x = -Math.PI / 2
      road.position.set((c - cols / 2) * step, 0.01, 0)
      road.receiveShadow = true
      city.add(road)
    }
    for (let r = 0; r <= rows; r++) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(cols * step + GAP, GAP * 0.8), mats.road)
      road.rotation.x = -Math.PI / 2
      road.position.set(0, 0.012, (r - rows / 2) * step)
      road.receiveShadow = true
      city.add(road)
    }
    ctx.span = span
    const half = span / 2 + PLOT
    sun.position.set(half * 0.8, half * 1.6 + 20, half * 0.6)
    sun.target.position.set(0, 0, 0)
    Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: half * 6 })
    sun.shadow.camera.updateProjectionMatrix()
    ctx.renderer.shadowMap.needsUpdate = true
    ctx.poke?.()
    if (!ctx.placed) {
      const d = Math.max(24, span * 1.25)
      camera.position.set(d * 0.7, d * 0.75, d * 0.9)
      controls.target.set(0, 0, 0)
      ctx.placed = true
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { ctxRef.current?.resize?.() }, [rightInset])

  // realce do lote sob o mouse
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.plots.forEach((p, id) => { p.plot.material = id === hover ? ctx.mats.plotHover : ctx.mats.plot })
    ctx.poke?.()
  }, [hover, key])

  // pedido de foco vindo de fora (busca / missão): voa até a loja sem entrar
  useEffect(() => {
    if (focusId?.id) ctxRef.current?.flyTo?.(focusId.id, !!focusId.enter)
  }, [focusId])

  if (failed) return null
  return (
    <div className="kw-city" style={{ height }}>
      <div ref={hostRef} className="kw-city-canvas" />
      <div className="kw-labels">
        {stores.map(s => (
          <button
            key={s.id}
            type="button"
            ref={el => { if (el) labelRefs.current.set(s.id, el); else labelRefs.current.delete(s.id) }}
            className={`kw-label st-${s.draft ? 'draft' : s.status || 'none'}${hover === s.id ? ' hover' : ''}`}
            onClick={() => ctxRef.current?.flyTo?.(s.id, true)}
          >
            <strong>{s.name}</strong>
            <span className="kw-label-meta">
              {s.draft ? labels.draft : s.late ? <b className="kw-n late">{s.late}</b> : null}
              {!s.draft && s.soon ? <b className="kw-n soon">{s.soon}</b> : null}
              {!s.draft && !s.late && !s.soon ? <b className="kw-n ok">✓</b> : null}
              {s.sub ? <em>{s.sub}</em> : null}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
