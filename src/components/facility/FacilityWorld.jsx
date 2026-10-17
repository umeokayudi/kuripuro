import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { AREA_KINDS, ELEMENT_KINDS } from '../../lib/facilityModel'
import './facility.css'

/**
 * Smart Facility em 3D de verdade (three.js), com dois jeitos de ver:
 *  - 'orbit': vista de cima girando como num jogo de construção;
 *  - 'walk':  primeira pessoa, a pessoa "entra" na loja (joystick no celular, WASD/setas no computador).
 * Tocar num equipamento chama onSelect({type,id}); o selecionado sobe em alto relevo e brilha.
 * Coordenadas da planta (x→direita, y→fundo) viram x/z do mundo, centralizadas na origem.
 */

const EYE = 1.6
const WALK_SPEED = 1.7
const LIFT = 0.45

const KIND_COLORS = {
  range_hood: '#cbd5e1', stove: '#94a3b8', fryer: '#94a3b8', oven: '#64748b', fridge: '#e0f2fe',
  dishwasher: '#bae6fd', sink: '#e2e8f0', grease_trap: '#78716c', duct: '#a8a29e', grating: '#57534e',
  table: '#b45309', counter: '#92400e', toilet: '#f8fafc', light_switch: '#facc15', breaker: '#fde047',
  valve: '#f87171', light: '#fef9c3', air_conditioner: '#f1f5f9', floor: '#64748b', window: '#7dd3fc', other: '#e2e8f0',
}
const STATUS_COLORS = { overdue: '#ef4444', due: '#f59e0b', ok: '#22c55e', none: '#94a3b8' }

function textCanvas(text, { size = 64, color = '#fff', bg = null, pad = 14, bold = true } = {}) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  const font = `${bold ? '700 ' : ''}${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = size + pad * 2
  c.width = w
  c.height = h
  ctx.font = font
  if (bg) {
    ctx.fillStyle = bg
    const r = h / 2
    ctx.beginPath()
    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2)
    ctx.fill()
  }
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, pad, h / 2 + size * 0.04)
  return c
}

function sprite(text, height, opts) {
  const canvas = textCanvas(text, opts)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const sp = new THREE.Sprite(mat)
  sp.scale.set(height * (canvas.width / canvas.height), height, 1)
  return sp
}

function floorLabel(text, width) {
  const canvas = textCanvas(text, { size: 56, color: 'rgba(255,255,255,0.92)' })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const h = Math.min(0.55, (width * 0.8) * canvas.height / canvas.width)
  const geo = new THREE.PlaneGeometry(h * canvas.width / canvas.height, h)
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

/** Câmera da vista de cima enquadrando a loja inteira (em pé ou deitada, celular ou computador). */
function frameOrbit(ctx) {
  const { camera, controls, W, D } = ctx
  const fit = Math.max(W / Math.max(0.6, camera.aspect), D) * 0.5 + 1
  const dist = fit / Math.tan((camera.fov * Math.PI) / 360) * 1.05
  const dir = new THREE.Vector3(0.28, 0.95, 0.75).normalize()
  camera.position.copy(dir.multiplyScalar(dist))
  controls.target.set(0, 0, 0)
  controls.update()
}

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    mats.forEach(m => { m.map?.dispose?.(); m.dispose?.() })
  })
}

/** Ponto inicial do modo "andar": entrada, senão o meio da frente da loja, olhando para dentro. */
function startPose(layout) {
  const entrance = layout.areas.find(a => a.kind === 'entrance') || layout.areas.find(a => a.kind === 'dining')
  const W = layout.width
  const D = layout.depth
  const x = entrance ? entrance.x + entrance.w / 2 : W / 2
  const y = entrance ? Math.min(D - 0.5, entrance.y + entrance.d * 0.7) : D - 0.6
  return { x: x - W / 2, z: y - D / 2, yaw: 0 }
}

export default function FacilityWorld({
  layout,
  mode = 'orbit',
  selectedId = null,
  onSelect,
  status,
  todo,
  alerts,
  height = 440,
  labels = {},
}) {
  const hostRef = useRef(null)
  const miniRef = useRef(null)
  const ctxRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  const selectedRef = useRef(selectedId)
  const modeRef = useRef(mode)
  const joyRef = useRef({ x: 0, y: 0 })
  const [joyKnob, setJoyKnob] = useState({ x: 0, y: 0 })
  const [failed, setFailed] = useState(false)

  onSelectRef.current = onSelect
  selectedRef.current = selectedId

  // ---- renderer, câmera e laço de animação (uma vez) ----
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0d1f35')
    const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.46
    controls.minDistance = 2
    controls.maxDistance = 60

    scene.add(new THREE.HemisphereLight('#dbeafe', '#1e293b', 1.15))
    const sun = new THREE.DirectionalLight('#ffffff', 1.4)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    scene.add(sun)

    const world = new THREE.Group()
    scene.add(world)
    const raycaster = new THREE.Raycaster()
    const keys = new Set()
    const walk = { x: 0, z: 0, yaw: 0, pitch: -0.08 }
    const pointer = { down: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, id: null }
    const clock = new THREE.Clock()
    const ctx = { renderer, scene, camera, controls, world, sun, walk, pickables: [], elementNodes: new Map(), areaMeshes: [], W: 10, D: 8, bounce: [] }
    ctxRef.current = ctx

    const resize = () => {
      const w = host.clientWidth || 600
      const h = host.clientHeight || height
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = `${h}px`
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(host)

    const pick = (clientX, clientY) => {
      const r = renderer.domElement.getBoundingClientRect()
      const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
      raycaster.setFromCamera(v, camera)
      const hit = raycaster.intersectObjects(ctx.pickables, false)[0]
      if (hit?.object?.userData?.pick) onSelectRef.current?.(hit.object.userData.pick)
      else onSelectRef.current?.(null)
    }

    const onDown = (e) => {
      pointer.down = true
      pointer.id = e.pointerId
      pointer.sx = pointer.lx = e.clientX
      pointer.sy = pointer.ly = e.clientY
      pointer.moved = false
    }
    const onMove = (e) => {
      if (!pointer.down || e.pointerId !== pointer.id) return
      if (Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) > 6) pointer.moved = true
      if (modeRef.current === 'walk') {
        walk.yaw -= (e.clientX - pointer.lx) * 0.005
        walk.pitch = Math.max(-1.1, Math.min(0.9, walk.pitch - (e.clientY - pointer.ly) * 0.004))
      }
      pointer.lx = e.clientX
      pointer.ly = e.clientY
    }
    const onUp = (e) => {
      if (!pointer.down || e.pointerId !== pointer.id) return
      pointer.down = false
      if (!pointer.moved) pick(e.clientX, e.clientY)
    }
    const el = renderer.domElement
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    const onKey = (e) => {
      if (modeRef.current !== 'walk') return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      const k = e.key.toLowerCase()
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return
      e.preventDefault()
      if (e.type === 'keydown') keys.add(k); else keys.delete(k)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)

    let raf = 0
    let miniTick = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.05, clock.getDelta())
      const t = clock.elapsedTime

      if (modeRef.current === 'walk') {
        let fwd = 0
        let side = 0
        if (keys.has('w') || keys.has('arrowup')) fwd += 1
        if (keys.has('s') || keys.has('arrowdown')) fwd -= 1
        if (keys.has('a')) side -= 1
        if (keys.has('d')) side += 1
        if (keys.has('arrowleft')) walk.yaw += dt * 1.8
        if (keys.has('arrowright')) walk.yaw -= dt * 1.8
        fwd += -joyRef.current.y
        side += joyRef.current.x
        const sx = -Math.sin(walk.yaw)
        const sz = -Math.cos(walk.yaw)
        walk.x += (sx * fwd + Math.cos(walk.yaw) * side) * WALK_SPEED * dt
        walk.z += (sz * fwd - Math.sin(walk.yaw) * side) * WALK_SPEED * dt
        walk.x = Math.max(-ctx.W / 2 + 0.25, Math.min(ctx.W / 2 - 0.25, walk.x))
        walk.z = Math.max(-ctx.D / 2 + 0.25, Math.min(ctx.D / 2 - 0.25, walk.z))
        camera.position.set(walk.x, EYE, walk.z)
        camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ')
      } else {
        controls.update()
      }

      // alto relevo: o selecionado sobe, cresce um pouco e brilha
      for (const [id, node] of ctx.elementNodes) {
        const sel = id === selectedRef.current
        node.lift += ((sel ? LIFT : 0) - node.lift) * Math.min(1, dt * 9)
        node.group.position.y = node.lift
        const sc = 1 + node.lift * 0.18
        node.group.scale.set(sc, sc, sc)
        node.mat.emissiveIntensity = sel ? 0.35 + Math.sin(t * 5) * 0.15 : 0
        node.outline.visible = sel
        if (node.halo) node.halo.material.opacity = sel ? 0.55 + Math.sin(t * 5) * 0.2 : 0
      }
      for (const b of ctx.bounce) b.sprite.position.y = b.base + Math.sin(t * 3 + b.phase) * 0.08

      renderer.render(scene, camera)

      if (modeRef.current === 'walk' && miniRef.current && ++miniTick % 4 === 0) drawMini(miniRef.current, ctx)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      controls.dispose()
      disposeTree(scene)
      renderer.dispose()
      el.remove()
      ctxRef.current = null
    }
  }, [height])

  // ---- monta a loja sempre que a planta muda ----
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { world, sun } = ctx
    disposeTree(world)
    world.clear()
    ctx.pickables = []
    ctx.elementNodes = new Map()
    ctx.bounce = []
    const W = layout.width
    const D = layout.depth
    ctx.W = W
    ctx.D = D
    const cx = x => x - W / 2
    const cz = y => y - D / 2

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.95 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    world.add(floor)
    const grid = new THREE.GridHelper(Math.max(W, D), Math.round(Math.max(W, D)), '#334155', '#26364d')
    grid.position.y = 0.002
    grid.scale.set(W / Math.max(W, D), 1, D / Math.max(W, D))
    world.add(grid)

    for (const a of layout.areas) {
      const k = AREA_KINDS[a.kind] || AREA_KINDS.other
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(a.w, a.d),
        new THREE.MeshStandardMaterial({ color: k.color, transparent: true, opacity: 0.38, roughness: 0.9 }),
      )
      patch.rotation.x = -Math.PI / 2
      patch.position.set(cx(a.x + a.w / 2), 0.006, cz(a.y + a.d / 2))
      patch.receiveShadow = true
      patch.userData.pick = { type: 'area', id: a.id }
      world.add(patch)
      ctx.pickables.push(patch)
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(a.w, a.d)),
        new THREE.LineBasicMaterial({ color: k.color }),
      )
      border.rotation.x = -Math.PI / 2
      border.position.copy(patch.position).setY(0.01)
      world.add(border)
      const label = floorLabel(`${k.icon} ${a.name}`, a.w)
      label.position.set(cx(a.x + 0.15) + label.geometry.parameters.width / 2, 0.012, cz(a.y + 0.15) + label.geometry.parameters.height / 2)
      world.add(label)
    }

    for (const wl of layout.walls) {
      const len = Math.hypot(wl.x2 - wl.x1, wl.y2 - wl.y1)
      if (len < 0.05) continue
      const h = wl.h || 2.4
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(len, h, 0.12),
        new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.8, transparent: true, opacity: 0.88 }),
      )
      wall.position.set(cx((wl.x1 + wl.x2) / 2), h / 2, cz((wl.y1 + wl.y2) / 2))
      wall.rotation.y = -Math.atan2(wl.y2 - wl.y1, wl.x2 - wl.x1)
      wall.castShadow = true
      wall.receiveShadow = true
      world.add(wall)
    }

    for (const e of layout.elements) {
      const k = ELEMENT_KINDS[e.kind] || ELEMENT_KINDS.other
      const h = Math.max(0.04, e.h || k.h || 0.5)
      const z0 = k.z || 0
      const group = new THREE.Group()
      const base = new THREE.Group()
      base.position.set(cx(e.x + e.w / 2), 0, cz(e.y + e.d / 2))
      base.add(group)
      world.add(base)

      const mat = new THREE.MeshStandardMaterial({ color: KIND_COLORS[e.kind] || '#e2e8f0', roughness: 0.45, metalness: 0.15, emissive: new THREE.Color('#c19c56'), emissiveIntensity: 0 })
      const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.08, e.w), h, Math.max(0.08, e.d)), mat)
      box.position.y = z0 + h / 2
      box.castShadow = true
      box.receiveShadow = true
      box.userData.pick = { type: 'element', id: e.id }
      group.add(box)
      ctx.pickables.push(box)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: '#0f172a', transparent: true, opacity: 0.45 }))
      edges.position.copy(box.position)
      group.add(edges)
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.max(0.08, e.w) + 0.06, h + 0.06, Math.max(0.08, e.d) + 0.06)), new THREE.LineBasicMaterial({ color: '#f5c76a' }))
      outline.position.copy(box.position)
      outline.visible = false
      group.add(outline)

      const icon = sprite(k.icon, 0.42, { size: 72, pad: 6 })
      icon.position.y = z0 + h + 0.32
      group.add(icon)

      const st = status?.get?.(e.id)
      if (st) {
        const r = Math.max(e.w, e.d) * 0.62 + 0.12
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r, r + 0.07, 40),
          new THREE.MeshBasicMaterial({ color: STATUS_COLORS[st], transparent: true, opacity: st === 'none' ? 0.45 : 0.9, side: THREE.DoubleSide }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(base.position.x, 0.015, base.position.z)
        world.add(ring)
      }
      const halo = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(e.w, e.d) * 0.7 + 0.25, 40),
        new THREE.MeshBasicMaterial({ color: '#f5c76a', transparent: true, opacity: 0, depthWrite: false }),
      )
      halo.rotation.x = -Math.PI / 2
      halo.position.set(base.position.x, 0.013, base.position.z)
      world.add(halo)

      const pins = []
      if (todo?.has?.(e.id)) pins.push('⭐')
      if (alerts?.has?.(e.id)) pins.push('❗')
      if (e.important && e.photos?.length) pins.push('📷')
      if (pins.length) {
        const pin = sprite(pins.join(''), 0.34, { size: 64, pad: 10, bg: 'rgba(13,31,53,0.85)' })
        pin.position.y = z0 + h + 0.8
        group.add(pin)
        ctx.bounce.push({ sprite: pin, base: pin.position.y, phase: Math.random() * 6 })
      }
      ctx.elementNodes.set(e.id, { group, mat, outline, halo, lift: 0 })
    }

    const span = Math.max(W, D)
    sun.position.set(span * 0.4, span * 1.2, span * 0.6)
    sun.shadow.camera.left = -span
    sun.shadow.camera.right = span
    sun.shadow.camera.top = span
    sun.shadow.camera.bottom = -span
    sun.shadow.camera.far = span * 4
    sun.shadow.camera.updateProjectionMatrix()

    if (!ctx.framed) {
      frameOrbit(ctx)
      ctx.framed = true
      const p = startPose(layout)
      Object.assign(ctx.walk, p)
    }
  }, [layout, status, todo, alerts])

  // ---- troca de modo ----
  useEffect(() => {
    modeRef.current = mode
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.controls.enabled = mode !== 'walk'
    if (mode === 'walk') {
      const p = startPose(layout)
      if (!ctx.walkStarted) { Object.assign(ctx.walk, p, { pitch: -0.08 }); ctx.walkStarted = true }
    } else {
      frameOrbit(ctx)
    }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- vista de cima: a câmera desliza até o item escolhido ----
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || mode === 'walk' || !selectedId) return
    const el = layout.elements.find(e => e.id === selectedId)
    if (!el) return
    const target = new THREE.Vector3(el.x + el.w / 2 - ctx.W / 2, 0.4, el.y + el.d / 2 - ctx.D / 2)
    const from = ctx.controls.target.clone()
    let f = 0
    const id = setInterval(() => {
      f = Math.min(1, f + 0.08)
      ctx.controls.target.lerpVectors(from, target, 1 - Math.pow(1 - f, 3))
      if (f >= 1) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [selectedId, mode, layout])

  const joyStart = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const pad = e.currentTarget.getBoundingClientRect()
    const move = (ev) => {
      const dx = (ev.clientX - (pad.left + pad.width / 2)) / (pad.width / 2)
      const dy = (ev.clientY - (pad.top + pad.height / 2)) / (pad.height / 2)
      const len = Math.hypot(dx, dy)
      const k = len > 1 ? 1 / len : 1
      joyRef.current = { x: dx * k, y: dy * k }
      setJoyKnob({ x: dx * k, y: dy * k })
    }
    const end = () => {
      joyRef.current = { x: 0, y: 0 }
      setJoyKnob({ x: 0, y: 0 })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    move(e)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  if (failed) return <div className="fac-block">{labels.no3d || '3D is not available on this device.'}</div>

  return (
    <div className="fac-world" style={{ height }}>
      <div ref={hostRef} className="fac-world-canvas" style={{ height }} />
      {mode === 'walk' && (
        <>
          <canvas ref={miniRef} className="fac-minimap" width={140} height={110} />
          <div className="fac-joy" onPointerDown={joyStart}>
            <div className="fac-joy-knob" style={{ transform: `translate(${joyKnob.x * 28}px, ${joyKnob.y * 28}px)` }} />
          </div>
          <div className="fac-walk-hint">{labels.walkHint}</div>
        </>
      )}
    </div>
  )
}

/** Mini-mapa do modo andar: planta vista de cima com a posição e a direção da pessoa. */
function drawMini(canvas, ctx) {
  const g = canvas.getContext('2d')
  const { W, D, walk } = ctx
  const s = Math.min((canvas.width - 10) / W, (canvas.height - 10) / D)
  const ox = (canvas.width - W * s) / 2
  const oy = (canvas.height - D * s) / 2
  g.clearRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = 'rgba(13,31,53,0.82)'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#1e293b'
  g.fillRect(ox, oy, W * s, D * s)
  for (const node of ctx.pickables) {
    const p = node.userData.pick
    if (p?.type !== 'area') continue
    const geo = node.geometry.parameters
    const c = node.material.color
    g.fillStyle = `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},0.55)`
    g.fillRect(ox + (node.position.x + W / 2 - geo.width / 2) * s, oy + (node.position.z + D / 2 - geo.height / 2) * s, geo.width * s, geo.height * s)
  }
  const px = ox + (walk.x + W / 2) * s
  const py = oy + (walk.z + D / 2) * s
  g.fillStyle = '#f5c76a'
  g.beginPath()
  g.moveTo(px - Math.sin(walk.yaw) * 9, py - Math.cos(walk.yaw) * 9)
  g.lineTo(px - Math.sin(walk.yaw + 2.5) * 6, py - Math.cos(walk.yaw + 2.5) * 6)
  g.lineTo(px - Math.sin(walk.yaw - 2.5) * 6, py - Math.cos(walk.yaw - 2.5) * 6)
  g.closePath()
  g.fill()
}
