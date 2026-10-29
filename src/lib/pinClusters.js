/**
 * Agrupa pinos que ficariam com o nome em cima um do outro na tela.
 * Recebe pontos já em pixels ({ x, y, ... }) e devolve grupos { x, y, items }.
 * Um pino entra no primeiro grupo cujo centro está a menos de `dx` na horizontal e `dy` na vertical
 * (o nome do pino é largo e baixo, por isso a caixa é mais larga que alta).
 */
export function clusterPixels(points, { dx = 180, dy = 30 } = {}) {
  const groups = []
  for (const p of points) {
    const g = groups.find(c => Math.abs(c.x - p.x) < dx && Math.abs(c.y - p.y) < dy)
    if (g) {
      g.items.push(p)
      g.x = g.items.reduce((s, i) => s + i.x, 0) / g.items.length
      g.y = g.items.reduce((s, i) => s + i.y, 0) / g.items.length
    } else {
      groups.push({ x: p.x, y: p.y, items: [p] })
    }
  }
  return groups
}

const RANK = { overdue: 4, due: 3, week: 2, ok: 1, none: 0 }
/** A cor do grupo é a do pior status dentro dele (vermelho > âmbar > verde). */
export function worstStatus(list) {
  return list.reduce((w, s) => ((RANK[s] || 0) > (RANK[w] || 0) ? s : w), 'none')
}
