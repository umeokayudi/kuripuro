// v1.0.234 · Simple viewer for a scanned 3D model (.glb): drag to turn, pinch / wheel to zoom.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export default function GlbViewer({ url }) {
  const ref = useRef(null)
  const [state, setState] = useState('loading')
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let renderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }) } catch { setState('nogl'); return undefined }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf1f3f7)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a6, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 6, 4); scene.add(sun)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 2000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    let alive = true, raf = 0, dirty = true
    const size = () => { const w = el.clientWidth || 1, h = el.clientHeight || 1; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true }
    const ro = new ResizeObserver(size); ro.observe(el); size()
    controls.addEventListener('change', () => { dirty = true })
    // draws only when something moved: no battery spent while the model sits still
    const loop = () => { if (!alive) return; if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false } raf = requestAnimationFrame(loop) }
    new GLTFLoader().load(url, gltf => {
      if (!alive) return
      const box = new THREE.Box3().setFromObject(gltf.scene)
      const center = box.getCenter(new THREE.Vector3()), dim = box.getSize(new THREE.Vector3())
      const r = Math.max(dim.x, dim.y, dim.z) || 1
      gltf.scene.position.sub(center)
      scene.add(gltf.scene)
      camera.position.set(r * 1.3, r * 1.0, r * 1.7); camera.near = r / 200; camera.far = r * 50; camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0); controls.update()
      dirty = true
      setState('ready')
    }, undefined, () => { if (alive) setState('error') })
    loop()
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove() }
  }, [url])
  return (
    <div ref={ref} className="s3-canvas" data-state={state}>
      {state === 'loading' && <p className="s3-loading">…</p>}
      {state === 'error' && <p className="s3-loading">Não consegui abrir este modelo.</p>}
      {state === 'nogl' && <p className="s3-loading">Este aparelho não mostra 3D.</p>}
    </div>
  )
}
