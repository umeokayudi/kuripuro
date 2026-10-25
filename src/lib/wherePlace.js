// "Onde fica" (luz, materiais de limpeza, disjuntor): grava foto + frase num item da planta, ou cria o item.
import { levelLayout, mergeLevel, normalizeLayout } from './facilityModel'
import { placeItem } from './facilityBuilder'
import { saveModel } from './facilityApi'
import { uploadJobPhoto } from './uploadPhoto'

export async function saveWherePlace({ model, level = 0, kind, el = null, files = [], hint = '', areaId = null, lang = 'pt' }) {
  const base = model.layout
  const id = el?.id || null
  const paths = []
  for (const [i, f] of files.entries()) {
    paths.push(await uploadJobPhoto(`facility/${model.id}/where_${id || kind}_${Date.now()}_${i}.jpg`, f))
  }
  let next
  if (el) {
    next = normalizeLayout({
      ...base,
      elements: base.elements.map(e => (e.id === el.id
        ? { ...e, photos: [...(e.photos || []), ...paths], location_hint: hint || e.location_hint || '', important: true }
        : e)),
    })
  } else {
    const floor = levelLayout(base, level)
    const placed = placeItem(floor, kind, { areaId, lang })
    const withInfo = {
      ...placed.layout,
      elements: placed.layout.elements.map(e => (e.id === placed.id ? { ...e, photos: paths, location_hint: hint, important: true } : e)),
    }
    next = mergeLevel(base, level, withInfo)
  }
  return saveModel({ ...model, layout: next })
}
