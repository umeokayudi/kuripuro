import { clusterPixels } from '../../lib/pinClusters'

/**
 * Camada de pinos sobre o Google Maps (OverlayView com HTML próprio, sem Map ID).
 * Mantém o visual dos pinos do mapa antigo (bolinha + nome) e agrupa os que ficariam
 * com o nome em cima um do outro. Itens com `fixed` (selecionado, paradas da rota, eu, régua) nunca entram em grupo.
 * `onClick` recebe { kind: 'one', ...item } ou { kind: 'cluster', items }.
 */
export function createPinLayer(g, map, onClick, clusterHtml) {
  class PinLayer extends g.maps.OverlayView {
    constructor() {
      super()
      this.items = []
      this.rendered = []
      this.el = document.createElement('div')
      this.el.className = 'cm-gpins'
    }

    onAdd() {
      this.getPanes().overlayMouseTarget.appendChild(this.el)
      g.maps.OverlayView.preventMapHitsAndGesturesFrom(this.el)
      this.el.addEventListener('click', e => {
        const t = e.target.closest('[data-g]')
        if (!t) return
        e.stopPropagation()
        const r = this.rendered[Number(t.dataset.g)]
        if (r) onClick(r)
      })
    }

    onRemove() { this.el.remove() }

    setItems(items) {
      this.items = items
      this.draw()
    }

    draw() {
      const proj = this.getProjection()
      if (!proj) return
      const px = it => {
        const p = proj.fromLatLngToDivPixel(new g.maps.LatLng(it.lat, it.lng))
        return { ...it, x: p.x, y: p.y }
      }
      const loose = this.items.filter(i => !i.fixed).map(px)
      const fixed = this.items.filter(i => i.fixed).map(px)
      this.rendered = [
        ...clusterPixels(loose).map(c => (c.items.length === 1 ? { kind: 'one', ...c.items[0] } : { kind: 'cluster', x: c.x, y: c.y, z: 200, items: c.items })),
        ...fixed.map(f => ({ kind: 'one', ...f })),
      ]
      this.el.innerHTML = this.rendered
        .map((r, i) => `<div class="cm-gpin" data-g="${i}" style="left:${r.x}px;top:${r.y}px;z-index:${r.z || 0}">${r.kind === 'cluster' ? clusterHtml(r.items) : r.html}</div>`)
        .join('')
    }
  }
  const layer = new PinLayer()
  layer.setMap(map)
  return layer
}
