import * as THREE from 'three'
import { ELEMENT_KINDS } from '../../../lib/facilityModel'

/**
 * Modelos 3D de cada tipo de equipamento, montados com formas simples mas com cara de objeto real
 * (mesa com pernas e cadeiras, fogão com bocas, coifa em pirâmide com duto, geladeira com portas...).
 * Origem local = centro do item no chão; largura em x, profundidade em z, frente virada para +z.
 */

let M = null
function mats() {
  if (M) return M
  const std = (color, roughness = 0.6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra })
  M = {
    steel: std('#c9ced4', 0.32, 0.85),
    steelDark: std('#7d848c', 0.4, 0.8),
    black: std('#1f2328', 0.55, 0.2),
    burner: std('#2b2f33', 0.35, 0.6),
    flame: std('#3b82f6', 0.4, 0, { emissive: new THREE.Color('#2563eb'), emissiveIntensity: 0.6 }),
    tableTop: std('#a0673a', 0.55),
    tableLeg: std('#3a2a1e', 0.5, 0.3),
    chair: std('#6b4226', 0.6),
    counterTop: std('#d6d3cd', 0.35, 0.05),
    counterBody: std('#5b3a24', 0.6),
    ceramic: std('#f7f9fb', 0.18, 0.05),
    plastic: std('#f1f3f5', 0.45),
    panel: std('#9aa2ab', 0.5, 0.4),
    yellow: std('#facc15', 0.45),
    red: std('#dc2626', 0.45, 0.2),
    glass: std('#9ad3f5', 0.05, 0.1, { transparent: true, opacity: 0.35 }),
    frame: std('#e5e7eb', 0.4, 0.3),
    oil: std('#b98a1a', 0.2, 0.1),
    lamp: std('#fffbe6', 0.3, 0, { emissive: new THREE.Color('#fff4cc'), emissiveIntensity: 1.2 }),
    duct: std('#a8adb3', 0.35, 0.75),
    cabinet: std('#e2e8f0', 0.55),
    display: std('#0f172a', 0.2, 0.1, { emissive: new THREE.Color('#22c55e'), emissiveIntensity: 0.4 }),
  }
  return M
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

function chair(m, x, z, faceAngle) {
  const g = new THREE.Group()
  g.add(box(0.42, 0.04, 0.42, m.chair, 0, 0.45, 0))
  g.add(box(0.42, 0.42, 0.04, m.chair, 0, 0.68, -0.19))
  for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) g.add(cyl(0.018, 0.018, 0.45, m.tableLeg, lx, 0.225, lz, 8))
  g.position.set(x, 0, z)
  g.rotation.y = faceAngle
  return g
}

/** Tipos presos na parede: o chamador vira o item para o lado de dentro da sala. */
export const WALL_KINDS = new Set(['air_conditioner', 'light_switch', 'breaker', 'window'])
/** Tipos que a pessoa não atravessa no modo andar. */
export const SOLID_KINDS = new Set(['table', 'counter', 'stove', 'fryer', 'oven', 'fridge', 'dishwasher', 'sink', 'toilet', 'stairs', 'supplies', 'other'])

export function buildProp(el) {
  const m = mats()
  const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
  const g = new THREE.Group()
  const w = Math.max(0.1, el.w)
  const d = Math.max(0.1, el.d)
  const h = Math.max(0.04, el.h || k.h || 0.5)
  const wallW = Math.max(w, d)

  switch (el.kind) {
    case 'table': {
      const th = Math.min(0.78, Math.max(0.7, h))
      g.add(box(w, 0.045, d, m.tableTop, 0, th, 0))
      const lx = w / 2 - 0.08
      const lz = d / 2 - 0.08
      for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) g.add(cyl(0.025, 0.025, th, m.tableLeg, x, th / 2, z, 10))
      const perSide = Math.max(1, Math.floor(w / 0.65))
      for (let i = 0; i < perSide; i++) {
        const x = -w / 2 + (i + 0.5) * (w / perSide)
        g.add(chair(m, x, d / 2 + 0.28, Math.PI))
        g.add(chair(m, x, -d / 2 - 0.28, 0))
      }
      break
    }
    case 'counter': {
      g.add(box(w, 0.95, d, m.counterBody, 0, 0.475, 0))
      g.add(box(w + 0.06, 0.05, d + 0.06, m.counterTop, 0, 0.975, 0))
      break
    }
    case 'stove':
    case 'fryer': {
      g.add(box(w, 0.82, d, m.steel, 0, 0.41, 0))
      g.add(box(w, 0.05, d, m.black, 0, 0.845, 0))
      if (el.kind === 'stove') {
        const cols = Math.max(1, Math.round(w / 0.5))
        const rows = d > 0.6 ? 2 : 1
        for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
          const x = -w / 2 + (c + 0.5) * (w / cols)
          const z = -d / 2 + (r + 0.5) * (d / rows)
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 8, 24), m.burner)
          ring.rotation.x = Math.PI / 2
          ring.position.set(x, 0.885, z)
          g.add(ring)
          g.add(cyl(0.05, 0.05, 0.01, m.flame, x, 0.875, z))
        }
      } else {
        const baskets = Math.max(1, Math.round(w / 0.4))
        for (let b = 0; b < baskets; b++) {
          const x = -w / 2 + (b + 0.5) * (w / baskets)
          g.add(box(w / baskets - 0.08, 0.02, d - 0.15, m.oil, x, 0.875, 0))
          g.add(box(0.03, 0.03, 0.25, m.black, x, 0.95, d / 2 + 0.05))
        }
      }
      for (let i = 0; i < Math.max(2, Math.round(w / 0.25)); i++) {
        g.add(cyl(0.025, 0.025, 0.03, m.black, -w / 2 + 0.12 + i * 0.22, 0.72, d / 2 + 0.015, 12).rotateX(Math.PI / 2))
      }
      break
    }
    case 'oven': {
      g.add(box(w, h, d, m.steel, 0, h / 2, 0))
      g.add(box(w * 0.8, h * 0.45, 0.02, m.black, 0, h * 0.45, d / 2 + 0.01))
      g.add(box(w * 0.6, 0.03, 0.04, m.steelDark, 0, h * 0.75, d / 2 + 0.04))
      break
    }
    case 'fridge': {
      const fh = Math.max(1.6, h)
      g.add(box(w, fh, d, m.steel, 0, fh / 2, 0))
      const doors = w > 0.9 ? 2 : 1
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + (i + 0.5) * (w / doors)
        g.add(box(0.03, fh * 0.35, 0.04, m.steelDark, x + (doors === 2 ? (i === 0 ? w / 4 - 0.06 : -w / 4 + 0.06) : w / 2 - 0.1), fh * 0.6, d / 2 + 0.03))
      }
      if (doors === 2) g.add(box(0.01, fh - 0.1, 0.01, m.black, 0, fh / 2, d / 2 + 0.005))
      break
    }
    case 'dishwasher': {
      g.add(box(w, h, d, m.steel, 0, h / 2, 0))
      g.add(box(w * 0.9, 0.06, 0.02, m.black, 0, h - 0.08, d / 2 + 0.01))
      g.add(box(0.12, 0.03, 0.01, m.display, w * 0.3, h - 0.08, d / 2 + 0.025))
      break
    }
    case 'sink': {
      g.add(box(w, 0.85, d, m.steel, 0, 0.425, 0))
      g.add(box(w * 0.7, 0.02, d * 0.6, m.steelDark, 0, 0.855, 0))
      g.add(cyl(0.02, 0.02, 0.3, m.steel, 0, 1.0, -d / 2 + 0.08, 10))
      g.add(box(0.03, 0.03, 0.2, m.steel, 0, 1.14, -d / 2 + 0.17))
      break
    }
    case 'range_hood': {
      const z0 = k.z || 1.6
      // pirâmide de 4 lados: gira dentro de um grupo e o grupo estica (senão a coifa sai torta)
      const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.71, 0.55, 4, 1), m.steel)
      hood.rotation.y = Math.PI / 4
      hood.castShadow = true
      const hoodBox = new THREE.Group()
      hoodBox.add(hood)
      hoodBox.scale.set(w, 1, d)
      hoodBox.position.y = z0 + 0.3
      g.add(hoodBox)
      g.add(box(w, 0.06, d, m.steelDark, 0, z0 + 0.03, 0))
      g.add(box(Math.min(0.45, w * 0.3), 2.6 - (z0 + 0.58), Math.min(0.45, d * 0.5), m.duct, 0, (z0 + 0.58 + 2.6) / 2, 0))
      break
    }
    case 'duct': {
      g.add(box(w, Math.min(0.4, h), d, m.duct, 0, 2.4, 0))
      break
    }
    case 'grease_trap': {
      g.add(box(w, 0.03, d, m.steelDark, 0, 0.015, 0))
      for (let i = 1; i < 6; i++) g.add(box(w * 0.9, 0.005, 0.01, m.black, 0, 0.032, -d / 2 + (i * d) / 6))
      g.add(box(0.12, 0.02, 0.03, m.steel, 0, 0.045, 0))
      break
    }
    case 'grating': {
      const slats = Math.max(4, Math.round(w / 0.05))
      g.add(box(w, 0.01, d, m.black, 0, 0.005, 0))
      for (let i = 0; i < slats; i++) g.add(box(0.012, 0.02, d, m.steelDark, -w / 2 + (i + 0.5) * (w / slats), 0.015, 0))
      break
    }
    case 'toilet': {
      g.add(box(Math.min(w, 0.42), 0.38, 0.18, m.ceramic, 0, 0.6, -d / 2 + 0.09))
      const bowl = cyl(0.2, 0.16, 0.4, m.ceramic, 0, 0.2, 0.05, 24)
      bowl.scale.z = 1.3
      g.add(bowl)
      const seat = cyl(0.21, 0.21, 0.03, m.plastic, 0, 0.415, 0.05, 24)
      seat.scale.z = 1.3
      g.add(seat)
      break
    }
    case 'light_switch': {
      g.add(box(0.12, 0.12, 0.015, m.plastic, 0, 1.2, 0))
      g.add(box(0.035, 0.06, 0.012, m.frame, -0.025, 1.2, 0.012))
      g.add(box(0.035, 0.06, 0.012, m.frame, 0.025, 1.2, 0.012))
      break
    }
    case 'breaker': {
      g.add(box(Math.min(0.6, wallW), 0.6, 0.12, m.panel, 0, 1.45, 0))
      g.add(box(Math.min(0.56, wallW - 0.04), 0.56, 0.01, m.frame, 0, 1.45, 0.065))
      g.add(box(0.04, 0.12, 0.02, m.black, Math.min(0.24, wallW / 2 - 0.05), 1.45, 0.075))
      break
    }
    case 'valve': {
      g.add(cyl(0.035, 0.035, 0.7, m.steelDark, 0, 0.35, 0, 12))
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 8, 24), m.red)
      wheel.position.set(0, 0.55, 0.06)
      g.add(wheel)
      break
    }
    case 'air_conditioner': {
      const aw = Math.min(1.1, wallW)
      g.add(box(aw, 0.3, 0.24, m.plastic, 0, 2.3, 0))
      for (let i = 0; i < 4; i++) g.add(box(aw * 0.85, 0.008, 0.01, m.panel, 0, 2.2 - i * 0.02, 0.125))
      break
    }
    case 'window': {
      const ww = Math.min(2.5, wallW)
      g.add(box(ww, 1.1, 0.04, m.glass, 0, 1.5, 0))
      g.add(box(ww + 0.06, 0.05, 0.08, m.frame, 0, 2.07, 0))
      g.add(box(ww + 0.06, 0.05, 0.08, m.frame, 0, 0.93, 0))
      g.add(box(0.05, 1.1, 0.08, m.frame, 0, 1.5, 0))
      break
    }
    case 'light': {
      g.add(cyl(Math.min(0.3, w / 2), Math.min(0.3, w / 2), 0.04, m.lamp, 0, 2.58, 0, 24))
      break
    }
    case 'stairs': {
      if (el.level) {
        // andar de cima: o vão da escada (buraco escuro com guarda-corpo em volta)
        g.add(box(w, 0.01, d, m.black, 0, 0.006, 0))
        for (const [x, z, bw, bd] of [[0, -d / 2, w, 0.04], [-w / 2, 0, 0.04, d], [w / 2, 0, 0.04, d]]) {
          g.add(box(bw, 0.04, bd, m.steelDark, x, 0.95, z))
          g.add(box(Math.min(bw, 0.04), 0.95, Math.min(bd, 0.04), m.steelDark, x, 0.475, z))
        }
        break
      }
      // degraus subindo para o fundo (ou para a direita, se a escada estiver deitada)
      const along = d >= w
      const run = along ? d : w
      const n = 13
      const rise = 2.6 / n
      const step = run / n
      for (let i = 0; i < n; i++) {
        const sh = rise * (i + 1)
        const pos = run / 2 - step * (i + 0.5)
        g.add(along ? box(w, sh, step, m.tableTop, 0, sh / 2, pos) : box(step, sh, d, m.tableTop, -pos, sh / 2, 0))
      }
      const rail = along ? box(0.05, 0.05, run, m.steelDark, w / 2 - 0.03, 0, 0) : box(run, 0.05, 0.05, m.steelDark, 0, 0, d / 2 - 0.03)
      rail.position.y = 1.9
      rail.rotation[along ? 'x' : 'z'] = Math.atan2(2.6, run)
      g.add(rail)
      break
    }
    case 'supplies': {
      // estante com frascos coloridos e um balde: dá para reconhecer de longe
      const sh = Math.max(1.0, h)
      for (const y of [0.02, sh * 0.5, sh - 0.02]) g.add(box(w, 0.03, d, m.cabinet, 0, y, 0))
      for (const x of [-w / 2 + 0.02, w / 2 - 0.02]) g.add(box(0.03, sh, d, m.cabinet, x, sh / 2, 0))
      const colors = ['#38bdf8', '#f472b6', '#facc15', '#4ade80']
      for (let i = 0; i < 4; i++) {
        const mat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.4 })
        g.add(cyl(0.05, 0.05, 0.22, mat, -w / 2 + 0.12 + i * ((w - 0.24) / 3), sh * 0.5 + 0.13, 0, 10))
      }
      g.add(cyl(0.13, 0.11, 0.24, new THREE.MeshStandardMaterial({ color: '#2563eb', roughness: 0.5 }), w / 4, 0.15, 0, 14))
      break
    }
    case 'floor': {
      g.add(box(w, 0.005, d, new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.25 }), 0, 0.004, 0))
      break
    }
    default: {
      const z0 = k.z || 0
      g.add(box(w, h, d, m.cabinet, 0, z0 + h / 2, 0))
      g.add(box(w * 0.9, 0.02, 0.01, m.panel, 0, z0 + h * 0.75, d / 2 + 0.005))
    }
  }
  return { group: g, wall: WALL_KINDS.has(el.kind), top: topOf(el.kind, h, k) }
}

/** Altura do topo do objeto (onde ficam ícone e pinos). */
function topOf(kind, h, k) {
  if (kind === 'table') return 0.8
  if (kind === 'range_hood') return 2.6
  if (kind === 'fridge') return Math.max(1.6, h)
  if (kind === 'air_conditioner') return 2.45
  if (kind === 'light' || kind === 'duct') return 2.6
  if (kind === 'breaker') return 1.75
  if (kind === 'light_switch') return 1.3
  if (kind === 'window') return 2.1
  if (kind === 'stairs') return 1.4
  return (k.z || 0) + h
}
