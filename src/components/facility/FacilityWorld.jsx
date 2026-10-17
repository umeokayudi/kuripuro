import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { AREA_KINDS, ELEMENT_KINDS } from '../../lib/facilityModel'
import { AREA_FLOOR, floorTexture } from './world/textures'
import { buildProp, SOLID_KINDS, WALL_KINDS } from './world/props'
import './facility.css'

/**
 * Smart Facility em 3D de verdade (three.js), com dois jeitos de ver:
 *  - 'orbit': casa de bonecas — paredes cortadas na altura da cintura, a loja gira devagar até a pessoa mexer;
 *  - 'walk':  primeira pessoa com teto, luz de luminária, colisão com paredes e móveis,
 *             toque no chão para andar até lá, joystick no celular e WASD/setas no computador.
 * Tocar num equipamento chama onSelect({type,id}); o selecionado sobe em alto relevo e brilha.
 * Coordenadas da planta (x→direita, y→fundo) viram x/z do mundo, centralizadas na origem.
 */

const EYE = 1.6
const CEIL = 2.6
const CUT = 1.05
const WALK_SPEED = 1.9
const RADIUS = 0.26
const LIFT = 0.4
const WALL_T = 0.14
const LABEL_RANGE = 4.2

const STATUS_COLORS = { overdue: '#ef4444', due: '#f59e0b', ok: '#22c55e', none: '#94a3b8' }
// tipos encostados na parede que viram a frente para dentro da sala
const FACE_KINDS = new Set(['stove', 'fryer', 'oven', 'fridge', 'dishwasher', 'sink', 'counter', 'range_hood', 'toilet', 'other'])

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function textCanvas(text, { size = 64, color = '#fff', bg = null, border = null, pad = 14, bold = true, radius = null } = {}) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  const font = `${bold ? '700 ' : ''}${size}px system-ui, -apple-system, "Segoe UI", "Hiragino Sans", sans-serif`
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = size + pad * 2
  c.width = w
  c.height = h
  ctx.font = font
  if (bg) {
    ctx.fillStyle = bg
    roundRect(ctx, 2, 2, w - 4, h - 4, radius ?? (h - 4) / 2)
    ctx.fill()
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 4; ctx.stroke() }
  }
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, pad, h / 2 + size * 0.05)
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
  const canvas = textCanvas(text, { size: 56, color: 'rgba(255,255,255,0.95)', bg: 'rgba(13,31,53,0.62)', pad: 18, radius: 18 })
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  const h = Math.min(0.5, (width * 0.85) * canvas.height / canvas.width)
  const geo = new THREE.PlaneGeometry(h * canvas.width / canvas.height, h)
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }))
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 2
  return mesh
}

/** Câmera da vista de cima enquadrando a loja inteira (em pé ou deitada, celular ou computador). */
function frameOrbit(ctx) {
  const { camera, controls, W, D } = ctx
  const fit = Math.max(W / Math.max(0.6, camera.aspect), D) * 0.5 + 0.6
  const dist = fit / Math.tan((camera.fov * Math.PI) / 360) * 1.02
  const dir = new THREE.Vector3(0.35, 0.82, 0.78).normalize()
  camera.position.copy(dir.multiplyScalar(dist))
  controls.target.set(0, 0, 0.2)
  controls.update()
}

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.()
    if (o.userData.sharedMat) return
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    ms.forEach(m => { if (!m.userData?.shared) { m.map?.dispose?.(); m.dispose?.() } })
  })
}

/** Distância de um ponto a um segmento + ponto mais próximo (coordenadas da planta). */
function segInfo(px, py, s) {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len2 = dx * dx + dy * dy || 1e-6
  const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2))
  const qx = s.x1 + t * dx
  const qy = s.y1 + t * dy
  return { dist: Math.hypot(px - qx, py - qy), qx, qy, dx, dy }
}

/** Paredes de verdade da planta + contorno da loja quando a planta não desenhou o contorno. */
function allWalls(layout) {
  const W = layout.width
  const D = layout.depth
  const walls = layout.walls.filter(w => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) >= 0.05)
  const edges = [
    { x1: 0, y1: 0, x2: W, y2: 0 }, { x1: W, y1: 0, x2: W, y2: D },
    { x1: W, y1: D, x2: 0, y2: D }, { x1: 0, y1: D, x2: 0, y2: 0 },
  ]
  const out = walls.map(w => ({ ...w, real: true }))
  for (const e of edges) {
    const len = Math.hypot(e.x2 - e.x1, e.y2 - e.y1)
    let covered = 0
    for (const w of walls) {
      const a = segInfo(w.x1, w.y1, e)
      const b = segInfo(w.x2, w.y2, e)
      if (a.dist < 0.2 && b.dist < 0.2) covered += Math.hypot(w.x2 - w.x1, w.y2 - w.y1)
    }
    if (covered < len * 0.5) out.push({ ...e, real: true, perimeter: true })
  }
  return out
}

/** Ponto inicial do modo "andar": entrada, senão o meio da frente da loja, olhando para o centro. */
function startPose(layout, blocked) {
  const entrance = layout.areas.find(a => a.kind === 'entrance') || layout.areas.find(a => a.kind === 'dining')
  const W = layout.width
  const D = layout.depth
  let x = (entrance ? entrance.x + entrance.w / 2 : W / 2) - W / 2
  let z = (entrance ? Math.min(D - 0.6, entrance.y + entrance.d * 0.6) : D - 0.8) - D / 2
  // se nasceu dentro de um móvel, procura o lugar livre mais perto
  if (blocked?.(x, z)) {
    outer: for (let r = 0.4; r < 4; r += 0.4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const nx = x + Math.cos(a) * r
        const nz = z + Math.sin(a) * r
        if (!blocked(nx, nz)) { x = nx; z = nz; break outer }
      }
    }
  }
  const yaw = Math.atan2(x, z) // olhar para o centro (0,0): frente = (-sin yaw, -cos yaw)
  return { x, z, yaw, pitch: -0.12 }
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

  // ---- renderer, câmera, luz e laço de animação (uma vez) ----
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0d1f35')
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = envTex
    scene.environmentIntensity = 0.55

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxPolarAngle = Math.PI * 0.44
    controls.minPolarAngle = Math.PI * 0.08
    controls.minDistance = 2.5
    controls.maxDistance = 45
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.55
    controls.screenSpacePanning = false
    controls.addEventListener('start', () => { controls.autoRotate = false })

    const hemi = new THREE.HemisphereLight('#f1f5ff', '#3a3226', 0.75)
    scene.add(hemi)
    const sun = new THREE.DirectionalLight('#fff6e8', 2.1)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 4
    scene.add(sun)
    scene.add(sun.target)

    const world = new THREE.Group()
    scene.add(world)
    const raycaster = new THREE.Raycaster()
    const keys = new Set()
    const walk = { x: 0, z: 0, yaw: 0, pitch: -0.12, tYaw: 0, tPitch: -0.12, vx: 0, vz: 0, bob: 0, target: null }
    const pointer = { down: false, sx: 0, sy: 0, lx: 0, ly: 0, moved: false, id: null }
    const clock = new THREE.Clock()
    const ctx = {
      renderer, scene, camera, controls, world, sun, walk, envTex,
      pickables: [], floorPicks: [], elementNodes: new Map(), walls: [], wallMeshes: [], solids: [], walkOnly: [], orbitOnly: [],
      W: 10, D: 8, bounce: [], signs: [], marker: null,
    }
    ctxRef.current = ctx
    if (import.meta.env.DEV) window.__facWorld = ctx

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

    const ndc = (clientX, clientY) => {
      const r = renderer.domElement.getBoundingClientRect()
      return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    }
    const pick = (clientX, clientY) => {
      raycaster.setFromCamera(ndc(clientX, clientY), camera)
      const hits = raycaster.intersectObjects(ctx.pickables, false)
      const hit = hits[0]
      const p = hit?.object?.userData?.pick
      if (modeRef.current === 'walk') {
        // no modo andar: tocar num objeto seleciona; tocar no chão anda até lá
        if (p?.type === 'element') { onSelectRef.current?.(p); return }
        if (hit && hit.point.y < 0.05) {
          walk.target = { x: hit.point.x, z: hit.point.z }
          if (ctx.marker) { ctx.marker.position.set(hit.point.x, 0.02, hit.point.z); ctx.marker.userData.t = 1 }
          return
        }
        onSelectRef.current?.(null)
        return
      }
      if (p && p.type !== 'floor') onSelectRef.current?.(p)
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
      if (modeRef.current === 'walk' && pointer.moved) {
        const k = e.pointerType === 'touch' ? 0.006 : 0.0045
        walk.tYaw += (e.clientX - pointer.lx) * k
        walk.tPitch = Math.max(-1.05, Math.min(0.85, walk.tPitch + (e.clientY - pointer.ly) * k * 0.8))
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
    window.addEventListener('pointercancel', onUp)
    const WALK_KEYS = ['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']
    const onKey = (e) => {
      if (modeRef.current !== 'walk') return
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      const k = e.key.toLowerCase()
      if (!WALK_KEYS.includes(k)) return
      e.preventDefault()
      if (e.type === 'keydown') keys.add(k); else keys.delete(k)
    }
    const clearKeys = () => keys.clear()
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', clearKeys)

    // colisão: círculo da pessoa contra paredes e contra o chão ocupado por móveis
    const blocked = (x, z) => {
      const px = x + ctx.W / 2
      const py = z + ctx.D / 2
      if (px < RADIUS || py < RADIUS || px > ctx.W - RADIUS || py > ctx.D - RADIUS) return true
      for (const s of ctx.walls) if (segInfo(px, py, s).dist < RADIUS + WALL_T / 2) return true
      for (const b of ctx.solids) if (x > b.x0 - RADIUS && x < b.x1 + RADIUS && z > b.z0 - RADIUS && z < b.z1 + RADIUS) return true
      return false
    }
    ctx.blocked = blocked

    let raf = 0
    let miniTick = 0
    const tmp = new THREE.Vector3()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, clock.getDelta())
      const t = clock.elapsedTime
      const walking = modeRef.current === 'walk'

      // paredes: inteiras no modo andar; na casa de bonecas só as do fundo ficam inteiras,
      // as da frente e as internas descem até a cintura para dar para ver dentro
      for (const w of ctx.wallMeshes) {
        let want = CUT
        if (walking) want = w.full
        else if (w.outward) {
          const toCam = (camera.position.x - w.mx) * w.outward.x + (camera.position.z - w.mz) * w.outward.z
          if (toCam < 0) want = w.full
        }
        if (Math.abs(w.h - want) > 0.002) {
          w.h += (want - w.h) * Math.min(1, dt * 7)
          w.body.scale.y = w.h
          w.body.position.y = w.h / 2
          w.cap.position.y = w.h + 0.01
          w.cap.visible = w.h < CUT + 0.4
        }
      }

      if (walking) {
        let fwd = 0
        let side = 0
        if (keys.has('w') || keys.has('arrowup')) fwd += 1
        if (keys.has('s') || keys.has('arrowdown')) fwd -= 1
        if (keys.has('a')) side -= 1
        if (keys.has('d')) side += 1
        if (keys.has('arrowleft') || keys.has('q')) walk.tYaw += dt * 1.9
        if (keys.has('arrowright') || keys.has('e')) walk.tYaw -= dt * 1.9
        fwd += -joyRef.current.y
        side += joyRef.current.x
        const manual = Math.abs(fwd) > 0.05 || Math.abs(side) > 0.05
        let wx = 0
        let wz = 0
        if (manual) {
          walk.target = null
          const fx = -Math.sin(walk.yaw)
          const fz = -Math.cos(walk.yaw)
          wx = fx * fwd + Math.cos(walk.yaw) * side
          wz = fz * fwd - Math.sin(walk.yaw) * side
          const l = Math.hypot(wx, wz)
          if (l > 1) { wx /= l; wz /= l }
        } else if (walk.target) {
          const dx = walk.target.x - walk.x
          const dz = walk.target.z - walk.z
          const dist = Math.hypot(dx, dz)
          if (dist < 0.15) walk.target = null
          else {
            const s = Math.min(1, dist / 0.6)
            wx = (dx / dist) * s
            wz = (dz / dist) * s
            // vira a cabeça suavemente para onde está indo
            let dy = Math.atan2(-dx, -dz) - walk.tYaw
            dy = Math.atan2(Math.sin(dy), Math.cos(dy))
            walk.tYaw += dy * Math.min(1, dt * 3)
          }
        }
        // aceleração suave (sem tranco)
        walk.vx += (wx * WALK_SPEED - walk.vx) * Math.min(1, dt * 8)
        walk.vz += (wz * WALK_SPEED - walk.vz) * Math.min(1, dt * 8)
        const nx = walk.x + walk.vx * dt
        const nz = walk.z + walk.vz * dt
        // desliza encostado na parede em vez de travar
        let movedX = false
        let movedZ = false
        if (!blocked(nx, walk.z)) { walk.x = nx; movedX = true } else walk.vx *= 0.3
        if (!blocked(walk.x, nz)) { walk.z = nz; movedZ = true } else walk.vz *= 0.3
        if (walk.target && !movedX && !movedZ) walk.target = null
        const speed = Math.hypot(walk.vx, walk.vz)
        walk.bob += speed * dt * 5.5
        walk.yaw += (walk.tYaw - walk.yaw) * Math.min(1, dt * 14)
        walk.pitch += (walk.tPitch - walk.pitch) * Math.min(1, dt * 14)
        const bobY = Math.sin(walk.bob * 2) * 0.022 * Math.min(1, speed / WALK_SPEED)
        camera.position.set(walk.x, EYE + bobY, walk.z)
        camera.rotation.set(walk.pitch, walk.yaw, Math.sin(walk.bob) * 0.004, 'YXZ')
      } else {
        controls.update()
      }

      // alto relevo: o selecionado sobe (ou sai da parede), cresce um pouco e brilha
      for (const [id, node] of ctx.elementNodes) {
        const sel = id === selectedRef.current
        node.lift += ((sel ? 1 : 0) - node.lift) * Math.min(1, dt * 9)
        if (node.popOut) node.group.position.z = node.lift * 0.22
        else node.group.position.y = node.lift * LIFT
        const sc = 1 + node.lift * 0.08
        node.group.scale.set(sc, sc, sc)
        const glow = sel ? 0.28 + Math.sin(t * 5) * 0.12 : 0
        if (Math.abs(glow - node.glow) > 0.003) {
          node.glow = glow
          for (const m of node.mats) m.emissiveIntensity = glow + (m.userData.baseEmissive || 0)
        }
        node.outline.visible = sel
        if (node.halo) node.halo.material.opacity = sel ? 0.5 + Math.sin(t * 5) * 0.2 : 0
        // nome flutuando quando a pessoa chega perto (modo andar)
        if (node.nameTag) {
          if (walking) {
            node.nameTag.getWorldPosition(tmp)
            const dist = Math.hypot(tmp.x - walk.x, tmp.z - walk.z)
            const a = sel ? 1 : Math.max(0, Math.min(1, (LABEL_RANGE - dist) / 1.2))
            node.nameTag.material.opacity = a
            node.nameTag.visible = a > 0.02
          } else node.nameTag.visible = false
        }
      }
      // placas das áreas: só as próximas, para não amontoar no fundo
      if (walking) {
        for (const s of ctx.signs) {
          const dist = Math.hypot(s.position.x - walk.x, s.position.z - walk.z)
          const a = Math.max(0, Math.min(1, (6.5 - dist) / 2, (dist - 1.2) / 1.5))
          s.material.opacity = a
          s.visible = a > 0.02
        }
      }
      for (const b of ctx.bounce) b.sprite.position.y = b.base + Math.sin(t * 3 + b.phase) * 0.07
      if (ctx.marker && ctx.marker.userData.t > 0) {
        ctx.marker.userData.t = walk.target ? Math.max(0.35, ctx.marker.userData.t - dt * 0.6) : ctx.marker.userData.t - dt * 2
        const k = Math.max(0, ctx.marker.userData.t)
        ctx.marker.material.opacity = k
        ctx.marker.scale.setScalar(1 + Math.sin(t * 6) * 0.08)
        ctx.marker.visible = k > 0
      }

      renderer.render(scene, camera)

      if (walking && miniRef.current && ++miniTick % 3 === 0) drawMini(miniRef.current, ctx)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      window.removeEventListener('blur', clearKeys)
      controls.dispose()
      disposeTree(scene)
      envTex.dispose()
      pmrem.dispose()
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
    ctx.wallMeshes = []
    ctx.solids = []
    ctx.walkOnly = []
    ctx.orbitOnly = []
    ctx.signs = []
    const W = layout.width
    const D = layout.depth
    ctx.W = W
    ctx.D = D
    const cx = x => x - W / 2
    const cz = y => y - D / 2
    const walls = allWalls(layout)
    ctx.walls = walls
    ctx.areas = layout.areas
    ctx.elements = layout.elements

    // base da "casa de bonecas"
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.5, 0.35, D + 0.5),
      new THREE.MeshStandardMaterial({ color: '#16263c', roughness: 0.85 }),
    )
    plinth.position.y = -0.176
    plinth.receiveShadow = true
    world.add(plinth)
    ctx.orbitOnly.push(plinth)

    // piso de cimento em tudo + piso próprio de cada área (madeira, azulejo, cerâmica...)
    const base = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: floorTexture('concrete', W, D, 2), roughness: 0.9 }),
    )
    base.rotation.x = -Math.PI / 2
    base.receiveShadow = true
    base.userData.pick = { type: 'floor' }
    world.add(base)
    ctx.pickables.push(base)

    for (const a of layout.areas) {
      const k = AREA_KINDS[a.kind] || AREA_KINDS.other
      const texName = AREA_FLOOR[a.kind] || 'concrete'
      const tileM = texName === 'wood' || texName === 'darkwood' ? 1.6 : texName === 'stone' ? 1.2 : 1
      const patch = new THREE.Mesh(
        new THREE.PlaneGeometry(a.w, a.d),
        new THREE.MeshStandardMaterial({
          map: floorTexture(texName, a.w, a.d, tileM),
          roughness: texName === 'ceramic' ? 0.25 : texName === 'tile' ? 0.55 : 0.7,
          metalness: 0,
        }),
      )
      patch.rotation.x = -Math.PI / 2
      patch.position.set(cx(a.x + a.w / 2), 0.004, cz(a.y + a.d / 2))
      patch.receiveShadow = true
      patch.userData.pick = { type: 'area', id: a.id }
      patch.userData.area = { color: k.color }
      world.add(patch)
      ctx.pickables.push(patch)

      // faixa colorida na borda: dá para ver a divisão das áreas de cima
      const border = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(a.w - 0.04, a.d - 0.04)),
        new THREE.LineBasicMaterial({ color: k.color, transparent: true, opacity: 0.85 }),
      )
      border.rotation.x = -Math.PI / 2
      border.position.copy(patch.position).setY(0.008)
      world.add(border)
      ctx.orbitOnly.push(border)

      const label = floorLabel(`${k.icon} ${a.name}`, a.w)
      const lw = label.geometry.parameters.width
      const lh = label.geometry.parameters.height
      label.position.set(cx(a.x + 0.18) + lw / 2, 0.012, cz(a.y + a.d - 0.18) - lh / 2)
      world.add(label)
      ctx.orbitOnly.push(label)

      // placa pendurada com o nome da área (modo andar)
      const sign = sprite(`${k.icon} ${a.name}`, 0.26, { size: 48, pad: 16, bg: 'rgba(13,31,53,0.86)', border: k.color })
      sign.position.set(cx(a.x + a.w / 2), CEIL - 0.42, cz(a.y + a.d / 2))
      world.add(sign)
      ctx.walkOnly.push(sign)
      ctx.signs.push(sign)
    }

    // paredes de reboco com rodapé e topo escuro (o topo aparece quando a parede está cortada)
    const plaster = floorTexture('plaster', 2, 1, 1)
    const wallMat = new THREE.MeshStandardMaterial({ map: plaster, color: '#f3efe8', roughness: 0.92 })
    const capMat = new THREE.MeshStandardMaterial({ color: '#2a3b52', roughness: 0.7 })
    const skirtMat = new THREE.MeshStandardMaterial({ color: '#5c4a3a', roughness: 0.6 })
    for (const wl of walls) {
      const len = Math.hypot(wl.x2 - wl.x1, wl.y2 - wl.y1)
      const g = new THREE.Group()
      g.position.set(cx((wl.x1 + wl.x2) / 2), 0, cz((wl.y1 + wl.y2) / 2))
      g.rotation.y = -Math.atan2(wl.y2 - wl.y1, wl.x2 - wl.x1)
      const body = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T, 1, WALL_T), wallMat)
      body.castShadow = true
      body.receiveShadow = true
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.02, 0.02, WALL_T + 0.02), capMat)
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(len + WALL_T + 0.02, 0.1, WALL_T + 0.03), skirtMat)
      skirt.position.y = 0.05
      skirt.receiveShadow = true
      g.add(body, cap, skirt)
      world.add(g)
      const h = modeRef.current === 'walk' ? CEIL : CUT
      body.scale.y = h
      body.position.y = h / 2
      cap.position.y = h + 0.01
      // parede do contorno: normal apontando para fora da loja
      let outward = null
      const W2 = W / 2
      const D2 = D / 2
      const mx = (wl.x1 + wl.x2) / 2
      const my = (wl.y1 + wl.y2) / 2
      if (Math.abs(wl.y1) < 0.2 && Math.abs(wl.y2) < 0.2) outward = { x: 0, z: -1 }
      else if (Math.abs(wl.y1 - D) < 0.2 && Math.abs(wl.y2 - D) < 0.2) outward = { x: 0, z: 1 }
      else if (Math.abs(wl.x1) < 0.2 && Math.abs(wl.x2) < 0.2) outward = { x: -1, z: 0 }
      else if (Math.abs(wl.x1 - W) < 0.2 && Math.abs(wl.x2 - W) < 0.2) outward = { x: 1, z: 0 }
      ctx.wallMeshes.push({ body, cap, h, full: CEIL, outward, mx: mx - W2, mz: my - D2 })
    }
    wallMat.userData.shared = false

    // teto com luminárias (só no modo andar)
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.95 }))
    ceil.rotation.x = Math.PI / 2
    ceil.position.y = CEIL
    world.add(ceil)
    ctx.walkOnly.push(ceil)
    const panelMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: new THREE.Color('#fff7e0'), emissiveIntensity: 1.6 })
    const nx = Math.max(1, Math.round(W / 2.6))
    const nz = Math.max(1, Math.round(D / 2.6))
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.6), panelMat)
      p.position.set(-W / 2 + (i + 0.5) * (W / nx), CEIL - 0.016, -D / 2 + (j + 0.5) * (D / nz))
      world.add(p)
      ctx.walkOnly.push(p)
    }
    // algumas lâmpadas de verdade (sem sombra, para não pesar no celular)
    const lampCount = Math.min(4, nx * nz)
    for (let i = 0; i < lampCount; i++) {
      const lp = new THREE.PointLight('#fff1d6', 5, Math.max(W, D) * 0.9, 1.6)
      const ix = lampCount === 1 ? 0.5 : (i % 2) * 0.5 + 0.25
      const iz = lampCount <= 2 ? 0.5 : (i < 2 ? 0.25 : 0.75)
      lp.position.set(-W / 2 + ix * W, CEIL - 0.3, -D / 2 + iz * D)
      world.add(lp)
      ctx.walkOnly.push(lp)
    }

    // marcador de "andar até aqui"
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.24, 36),
      new THREE.MeshBasicMaterial({ color: '#f5c76a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    )
    marker.rotation.x = -Math.PI / 2
    marker.visible = false
    marker.userData.t = 0
    world.add(marker)
    ctx.marker = marker

    // equipamentos com modelo 3D próprio
    for (const e of layout.elements) {
      const k = ELEMENT_KINDS[e.kind] || ELEMENT_KINDS.other
      const pcx = e.x + e.w / 2
      const pcy = e.y + e.d / 2

      // encosta na parede mais próxima e vira a frente para dentro da sala
      let angle = 0
      let posX = pcx
      let posY = pcy
      const isWall = WALL_KINDS.has(e.kind)
      if (isWall || FACE_KINDS.has(e.kind)) {
        let best = null
        for (const s of walls) {
          const info = segInfo(pcx, pcy, s)
          if (!best || info.dist < best.dist) best = info
        }
        const reach = isWall ? 1.2 : Math.max(e.w, e.d) / 2 + 0.7
        if (best && best.dist < reach) {
          let nxp = pcx - best.qx
          let nyp = pcy - best.qy
          const l = Math.hypot(nxp, nyp)
          if (l < 1e-3) {
            // em cima da parede: usa a perpendicular que aponta para o centro da loja
            nxp = -best.dy; nyp = best.dx
            if (nxp * (W / 2 - pcx) + nyp * (D / 2 - pcy) < 0) { nxp = -nxp; nyp = -nyp }
          }
          const nl = Math.hypot(nxp, nyp) || 1
          nxp /= nl; nyp /= nl
          angle = Math.atan2(nxp, nyp)
          if (isWall && e.kind !== 'window') {
            const depth = e.kind === 'air_conditioner' ? 0.24 : e.kind === 'breaker' ? 0.12 : 0.02
            posX = best.qx + nxp * (WALL_T / 2 + depth / 2 + 0.005)
            posY = best.qy + nyp * (WALL_T / 2 + depth / 2 + 0.005)
          } else if (e.kind === 'window') {
            posX = best.qx
            posY = best.qy
          }
        }
      }
      const quarter = Math.abs(Math.sin(angle)) > 0.7
      const built = buildProp(quarter && !isWall ? { ...e, w: e.d, d: e.w } : e)
      const group = built.group
      // material próprio por item para o brilho de seleção não acender todos iguais
      const nodeMats = []
      group.traverse(o => {
        if (!o.isMesh) return
        o.material = o.material.clone()
        o.material.userData.baseEmissive = o.material.emissiveIntensity || 0
        if (!o.material.userData.baseEmissive) o.material.emissive = new THREE.Color('#f5b94a')
        nodeMats.push(o.material)
      })

      const holder = new THREE.Group()
      holder.position.set(cx(posX), 0, cz(posY))
      holder.rotation.y = angle
      holder.add(group)
      world.add(holder)
      holder.updateMatrixWorld(true)

      // caixa invisível para tocar (mais fácil que acertar uma perna de mesa)
      const bb = new THREE.Box3().setFromObject(group)
      const local = new THREE.Box3().copy(bb).applyMatrix4(new THREE.Matrix4().copy(holder.matrixWorld).invert())
      const size = local.getSize(new THREE.Vector3()).addScalar(0.08)
      size.x = Math.max(size.x, 0.25); size.y = Math.max(size.y, 0.25); size.z = Math.max(size.z, 0.25)
      const center = local.getCenter(new THREE.Vector3())
      const hit = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ visible: false }))
      hit.position.copy(center)
      hit.userData.pick = { type: 'element', id: e.id }
      holder.add(hit)
      ctx.pickables.push(hit)
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(hit.geometry), new THREE.LineBasicMaterial({ color: '#f5c76a' }))
      outline.position.copy(center)
      outline.visible = false
      group.add(outline)

      if (SOLID_KINDS.has(e.kind)) {
        ctx.solids.push({ x0: bb.min.x + 0.04, x1: bb.max.x - 0.04, z0: bb.min.z + 0.04, z1: bb.max.z - 0.04 })
      }

      const top = built.top
      const r = Math.max(e.w, e.d) * 0.6 + 0.15
      const st = status?.get?.(e.id)
      if (st && !isWall) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r, r + 0.06, 48),
          new THREE.MeshBasicMaterial({ color: STATUS_COLORS[st], transparent: true, opacity: st === 'none' ? 0.4 : 0.85, side: THREE.DoubleSide, depthWrite: false }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(cx(posX), 0.016, cz(posY))
        world.add(ring)
      }
      let halo = null
      if (!isWall) {
        halo = new THREE.Mesh(
          new THREE.CircleGeometry(r + 0.1, 48),
          new THREE.MeshBasicMaterial({ color: '#f5c76a', transparent: true, opacity: 0, depthWrite: false }),
        )
        halo.rotation.x = -Math.PI / 2
        halo.position.set(cx(posX), 0.014, cz(posY))
        world.add(halo)
      }

      // ícone redondo (vista de cima) com cor do estado
      const icon = sprite(k.icon, 0.36, { size: 64, pad: 12, bg: 'rgba(13,31,53,0.78)', border: st && st !== 'none' ? STATUS_COLORS[st] : 'rgba(255,255,255,0.35)' })
      icon.position.set(center.x, top + 0.32, center.z)
      group.add(icon)
      ctx.orbitOnly.push(icon)

      // nome que aparece de perto no modo andar
      const nameTag = sprite(`${k.icon} ${e.name}`, 0.15, { size: 44, pad: 14, bg: 'rgba(13,31,53,0.82)', border: st && st !== 'none' ? STATUS_COLORS[st] : null })
      nameTag.position.set(center.x, Math.min(CEIL - 0.15, top + 0.18), center.z)
      nameTag.visible = false
      group.add(nameTag)

      const pins = []
      if (todo?.has?.(e.id)) pins.push('⭐')
      if (alerts?.has?.(e.id)) pins.push('❗')
      if (e.important && e.photos?.length) pins.push('📷')
      if (pins.length) {
        const pin = sprite(pins.join(''), 0.3, { size: 60, pad: 12, bg: 'rgba(245,199,106,0.95)' })
        pin.position.set(center.x, Math.min(CEIL - 0.1, top + 0.7), center.z)
        group.add(pin)
        ctx.bounce.push({ sprite: pin, base: pin.position.y, phase: Math.random() * 6 })
      }
      ctx.elementNodes.set(e.id, { group, mats: nodeMats, outline, halo, nameTag, lift: 0, glow: 0, popOut: isWall || e.kind === 'range_hood' || e.kind === 'duct' || e.kind === 'light' })
    }

    const span = Math.max(W, D)
    sun.shadow.camera.left = -span * 0.75
    sun.shadow.camera.right = span * 0.75
    sun.shadow.camera.top = span * 0.75
    sun.shadow.camera.bottom = -span * 0.75
    sun.shadow.camera.far = span * 4
    sun.shadow.camera.updateProjectionMatrix()
    applyMode(ctx, modeRef.current)

    if (!ctx.framed) {
      frameOrbit(ctx)
      ctx.framed = true
    }
  }, [layout, status, todo, alerts])

  // ---- troca de modo ----
  useEffect(() => {
    modeRef.current = mode
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.controls.enabled = mode !== 'walk'
    applyMode(ctx, mode)
    if (mode === 'walk') {
      if (!ctx.walkStarted) {
        const p = startPose(layout, ctx.blocked)
        Object.assign(ctx.walk, p, { tYaw: p.yaw, tPitch: p.pitch, vx: 0, vz: 0, target: null })
        ctx.walkStarted = true
      }
      ctx.camera.fov = 72
    } else {
      ctx.camera.fov = 50
      ctx.camera.updateProjectionMatrix()
      frameOrbit(ctx)
    }
    ctx.camera.updateProjectionMatrix()
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- vista de cima: a câmera desliza até o item escolhido ----
  useEffect(() => {
    const ctx = ctxRef.current
    if (!ctx || mode === 'walk' || !selectedId) return
    const el = layout.elements.find(e => e.id === selectedId)
    if (!el) return
    ctx.controls.autoRotate = false
    const target = new THREE.Vector3(el.x + el.w / 2 - ctx.W / 2, 0.4, el.y + el.d / 2 - ctx.D / 2)
    const from = ctx.controls.target.clone()
    const camFrom = ctx.camera.position.clone()
    if (camFrom.distanceTo(from) < 5) camFrom.copy(from).add(camFrom.clone().sub(from).setLength(5 / 0.65))
    let f = 0
    const id = setInterval(() => {
      f = Math.min(1, f + 0.08)
      // câmera e alvo andam juntos: o item vai para o meio da tela sem a loja sair do quadro
      const k = 1 - Math.pow(1 - f, 3)
      ctx.controls.target.lerpVectors(from, target, k)
      // e chega um pouco mais perto do item escolhido
      ctx.camera.position.copy(camFrom).sub(from).multiplyScalar(1 - 0.35 * k).add(ctx.controls.target)
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
    <div className={`fac-world${mode === 'walk' ? ' is-walk' : ''}`} style={{ height }}>
      <div ref={hostRef} className="fac-world-canvas" style={{ height }} />
      {mode === 'walk' && (
        <>
          <div className="fac-crosshair" />
          <canvas ref={miniRef} className="fac-minimap" width={150} height={118} />
          <div className="fac-joy" onPointerDown={joyStart}>
            <div className="fac-joy-knob" style={{ transform: `translate(${joyKnob.x * 28}px, ${joyKnob.y * 28}px)` }} />
          </div>
          <div className="fac-walk-hint">{labels.walkHint}</div>
        </>
      )}
    </div>
  )
}

/** Mostra/esconde o que só existe em um dos modos e muda a luz (sol inclinado de cima x luz de teto). */
function applyMode(ctx, mode) {
  const walking = mode === 'walk'
  for (const o of ctx.walkOnly) o.visible = walking
  for (const o of ctx.orbitOnly) o.visible = !walking
  const span = Math.max(ctx.W, ctx.D)
  if (walking) {
    ctx.sun.position.set(span * 0.08, span * 1.5, span * 0.12)
    ctx.sun.intensity = 1.3
    ctx.scene.environmentIntensity = 0.75
    ctx.scene.background = new THREE.Color('#1a2333')
  } else {
    ctx.sun.position.set(span * 0.45, span * 1.1, span * 0.7)
    ctx.sun.intensity = 2.1
    ctx.scene.environmentIntensity = 0.55
    ctx.scene.background = new THREE.Color('#0d1f35')
  }
  ctx.sun.target.position.set(0, 0, 0)
}

/** Mini-mapa do modo andar: planta vista de cima com paredes, equipamentos e a direção da pessoa. */
function drawMini(canvas, ctx) {
  const g = canvas.getContext('2d')
  const { W, D, walk } = ctx
  const s = Math.min((canvas.width - 12) / W, (canvas.height - 12) / D)
  const ox = (canvas.width - W * s) / 2
  const oy = (canvas.height - D * s) / 2
  g.clearRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = 'rgba(13,31,53,0.85)'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.fillStyle = '#26364d'
  g.fillRect(ox, oy, W * s, D * s)
  for (const a of ctx.areas || []) {
    const c = (AREA_KINDS[a.kind] || AREA_KINDS.other).color
    g.fillStyle = c + '55'
    g.fillRect(ox + a.x * s, oy + a.y * s, a.w * s, a.d * s)
  }
  g.fillStyle = 'rgba(226,232,240,0.75)'
  for (const e of ctx.elements || []) {
    if (!SOLID_KINDS.has(e.kind)) continue
    g.fillRect(ox + e.x * s, oy + e.y * s, Math.max(2, e.w * s), Math.max(2, e.d * s))
  }
  g.strokeStyle = '#f1f5f9'
  g.lineWidth = 2
  g.beginPath()
  for (const w of ctx.walls) { g.moveTo(ox + w.x1 * s, oy + w.y1 * s); g.lineTo(ox + w.x2 * s, oy + w.y2 * s) }
  g.stroke()
  if (walk.target) {
    g.strokeStyle = '#f5c76a'
    g.setLineDash([3, 3])
    g.beginPath()
    g.moveTo(ox + (walk.x + W / 2) * s, oy + (walk.z + D / 2) * s)
    g.lineTo(ox + (walk.target.x + W / 2) * s, oy + (walk.target.z + D / 2) * s)
    g.stroke()
    g.setLineDash([])
  }
  const px = ox + (walk.x + W / 2) * s
  const py = oy + (walk.z + D / 2) * s
  // cone de visão
  const fov = 0.62
  g.fillStyle = 'rgba(245,199,106,0.25)'
  g.beginPath()
  g.moveTo(px, py)
  g.arc(px, py, 26, -Math.PI / 2 - walk.yaw - fov, -Math.PI / 2 - walk.yaw + fov)
  g.closePath()
  g.fill()
  g.fillStyle = '#f5c76a'
  g.beginPath()
  g.arc(px, py, 4, 0, Math.PI * 2)
  g.fill()
}
