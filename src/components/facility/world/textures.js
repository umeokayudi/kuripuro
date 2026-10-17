import * as THREE from 'three'

/**
 * Texturas desenhadas em canvas (sem baixar imagens): piso de madeira, azulejo de cozinha,
 * cerâmica de banheiro, cimento, pedra e parede. Cada uma cobre 1 m × 1 m e repete pela área.
 */

const cache = new Map()

function canvas(size = 512) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  return [c, c.getContext('2d')]
}

function noise(ctx, size, alpha = 0.05, count = 2500) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() > 0.5 ? 255 : 0
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2)
  }
}

const painters = {
  // tábuas de madeira (salão)
  wood(ctx, s) {
    const planks = 5
    const ph = s / planks
    for (let i = 0; i < planks; i++) {
      const shade = Math.random() * 24 - 12
      const base = [156, 106, 66].map(v => Math.round(v + shade))
      ctx.fillStyle = `rgb(${base.join(',')})`
      ctx.fillRect(0, i * ph, s, ph)
      for (let g = 0; g < 18; g++) {
        ctx.strokeStyle = `rgba(70,40,20,${0.08 + Math.random() * 0.1})`
        ctx.lineWidth = 1 + Math.random() * 1.5
        const y = i * ph + Math.random() * ph
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.bezierCurveTo(s * 0.3, y + Math.random() * 6 - 3, s * 0.6, y + Math.random() * 6 - 3, s, y)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(40,22,10,0.55)'
      ctx.fillRect(0, i * ph, s, 2)
      const cut = ((i * 0.37) % 1) * s
      ctx.fillRect(cut, i * ph, 2, ph)
    }
    noise(ctx, s, 0.05)
  },
  // azulejo antiderrapante cinza (cozinha / lavagem)
  tile(ctx, s) {
    const n = 4
    const t = s / n
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      const g = 112 + Math.random() * 12
      ctx.fillStyle = `rgb(${g},${g + 3},${g + 6})`
      ctx.fillRect(x * t, y * t, t, t)
    }
    noise(ctx, s, 0.08, 6000)
    ctx.strokeStyle = 'rgba(70,74,80,0.85)'
    ctx.lineWidth = 3
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke()
    }
  },
  // cerâmica branca (banheiro)
  ceramic(ctx, s) {
    const n = 5
    const t = s / n
    ctx.fillStyle = '#c9d2da'
    ctx.fillRect(0, 0, s, s)
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`
      ctx.fillRect(x * t + 3, y * t + 3, t - 6, t - 6)
    }
    ctx.strokeStyle = '#8f9aa5'
    ctx.lineWidth = 2
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke()
    }
  },
  // cimento queimado (estoque / escritório / fora das áreas)
  concrete(ctx, s) {
    ctx.fillStyle = '#74787c'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(Math.random() * s, Math.random() * s, 0, Math.random() * s, Math.random() * s, 60 + Math.random() * 120)
      const v = Math.random() > 0.5 ? 255 : 0
      g.addColorStop(0, `rgba(${v},${v},${v},0.06)`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    }
    noise(ctx, s, 0.1, 9000)
  },
  // pedra escura (entrada)
  stone(ctx, s) {
    const n = 2
    const t = s / n
    for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) {
      const g = 72 + Math.random() * 18
      ctx.fillStyle = `rgb(${g},${g},${g + 4})`
      ctx.fillRect(x * t, y * t, t, t)
    }
    noise(ctx, s, 0.12, 9000)
    ctx.strokeStyle = 'rgba(20,20,24,0.9)'
    ctx.lineWidth = 4
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, s); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(s, i * t); ctx.stroke()
    }
  },
  // madeira escura (bar)
  darkwood(ctx, s) {
    painters.wood(ctx, s)
    ctx.fillStyle = 'rgba(30,14,6,0.45)'
    ctx.fillRect(0, 0, s, s)
  },
  // parede com textura de reboco
  plaster(ctx, s) {
    ctx.fillStyle = '#ece7df'
    ctx.fillRect(0, 0, s, s)
    noise(ctx, s, 0.05, 12000)
  },
}

export const AREA_FLOOR = {
  dining: 'wood', bar: 'darkwood', kitchen: 'tile', washing: 'tile', ventilation: 'tile',
  restroom: 'ceramic', storage: 'concrete', office: 'wood', entrance: 'stone', other: 'concrete',
}

/** Textura (repetida a cada `meters` metros) para uma superfície de w × d metros. */
export function floorTexture(name, w, d, meters = 1) {
  let base = cache.get(name)
  if (!base) {
    const [c, ctx] = canvas(512)
    ;(painters[name] || painters.concrete)(ctx, 512)
    base = new THREE.CanvasTexture(c)
    base.colorSpace = THREE.SRGBColorSpace
    base.wrapS = base.wrapT = THREE.RepeatWrapping
    base.anisotropy = 8
    cache.set(name, base)
  }
  const tex = base.clone()
  tex.needsUpdate = true
  tex.repeat.set(Math.max(0.2, w / meters), Math.max(0.2, d / meters))
  return tex
}
