function locationNameFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

const BASE_ITEMS = [
  'Lixo banheiro',
  'Limpeza vaso (sem marca, sujeira borda)',
  'Limpar tapete (lixo)',
  'Piso sem marca alcool',
  'Ventilacao ligada',
  'Lixo pas retirado',
  'Chave no keybox',
  'Verificacao pos-video (sujeira piso)',
  'Coisas retiradas no lugar',
  'Luzes apagadas',
]

function withExtras(base, { afterFloor = [], replaceVentilation = null } = {}) {
  const items = [...base]
  const floorIdx = items.findIndex(i => i.startsWith('Piso sem marca'))
  if (floorIdx >= 0 && afterFloor.length) items.splice(floorIdx + 1, 0, ...afterFloor)
  if (replaceVentilation) {
    const vIdx = items.findIndex(i => i.toLowerCase().includes('ventilacao'))
    if (vIdx >= 0) items[vIdx] = replaceVentilation
  }
  return items
}

/** Checklist por loja — fonte única (KuriPuro OTP) */
export const LOCATION_CHECKLISTS = {
  'Atomic Bar': [...BASE_ITEMS],
  'Ibushio': [...BASE_ITEMS],
  'Nyu Ibushio': [...BASE_ITEMS],
  'Yakiniku Otoko Manmosu': [...BASE_ITEMS],
  'Horumon no Manmosu': withExtras(BASE_ITEMS, { replaceVentilation: 'Ventilacao desligada' }),
  'Nyu Sakana Yakio': withExtras(BASE_ITEMS, { afterFloor: ['Cadeiras abaixadas'] }),
  'Sakana Yakio Honten': withExtras(BASE_ITEMS, { afterFloor: ['Cadeiras abaixadas'] }),
  'Sakana Yakio 2': withExtras(BASE_ITEMS, { afterFloor: ['Cadeiras abaixadas'] }),
  'Tooda': withExtras(BASE_ITEMS, { afterFloor: ['Porta segundo andar fechada'] }),
  'Kodama Shinbashi': [...BASE_ITEMS],
  'Kodama Kinshicho': [...BASE_ITEMS],
  'Kodama Oimachi': [...BASE_ITEMS],
  'Kodama Yurakucho': [...BASE_ITEMS],
}

const ALIASES = {
  atomic: 'Atomic Bar',
  ibushio: 'Ibushio',
  'nyu ibushio': 'Nyu Ibushio',
  'new ibushio': 'Nyu Ibushio',
  manmoth: 'Yakiniku Otoko Manmosu',
  'yakiniku otoko manmosu': 'Yakiniku Otoko Manmosu',
  'hormonal manmoth': 'Horumon no Manmosu',
  'horumon no manmosu': 'Horumon no Manmosu',
  shinbashi: 'Kodama Shinbashi',
  'kodama shinbashi': 'Kodama Shinbashi',
  'kodama kinshicho': 'Kodama Kinshicho',
  'kodama oimachi': 'Kodama Oimachi',
  'kodama yurakucho': 'Kodama Yurakucho',
  'sakana yakio 2': 'Sakana Yakio 2',
  'sakana yakio honten': 'Sakana Yakio Honten',
  'sakana yakio': 'Sakana Yakio Honten',
  'new sakana yakio': 'Nyu Sakana Yakio',
  'nyu sakana yakio': 'Nyu Sakana Yakio',
  tooda: 'Tooda',
}

export function resolveChecklistLocationName(titleOrName) {
  const raw = locationNameFromTitle(titleOrName || '') || (titleOrName || '').trim()
  if (LOCATION_CHECKLISTS[raw]) return raw
  const lower = raw.toLowerCase()
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (lower === alias || lower.includes(alias)) return canonical
  }
  for (const name of Object.keys(LOCATION_CHECKLISTS)) {
    if (lower.includes(name.toLowerCase()) || name.toLowerCase().includes(lower)) return name
  }
  return raw
}

export function getChecklistItems(locationName) {
  const key = resolveChecklistLocationName(locationName)
  return LOCATION_CHECKLISTS[key] ? [...LOCATION_CHECKLISTS[key]] : []
}

export function checklistTemplateForJob(job) {
  const custom = (job?.checklist_template || '').trim()
  if (custom) return custom
  const items = getChecklistItems(job?.title || job?.location_name || '')
  return items.join('\n')
}

export function parseChecklistTemplate(template) {
  return (template || '').split('\n').map(l => l.trim()).filter(Boolean)
}

export function initChecklistState(job) {
  const template = checklistTemplateForJob(job)
  return parseChecklistTemplate(template).map(label => ({ label, done: false }))
}

export function checklistComplete(checklist) {
  return checklist.length > 0 && checklist.every(c => c.done)
}
