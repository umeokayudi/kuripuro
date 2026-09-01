import {
  getCleaningType,
  normalizeDeepComponents,
  parseDeepComponents,
} from './cleaningType'

function locationNameFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

const DEEP_COMPONENT_CHECKLIST = {
  range_hood: 'Range Hood — limpeza completa (filtros, duto, superficie)',
  ac: 'AC Cleaning — filtros e unidade interna',
  grating: 'Grating — grelha limpa sem gordura',
  grease_trap: 'Grease Trap — esvaziado e higienizado',
  stove: 'Stove — fogões limpos e sem gordura',
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

/** Atomic Bar — bar/noturno (diferente dos restaurantes OTP) */
const ATOMIC_BAR_ITEMS = [
  'Retirar TODO o lixo (bar, salao, banheiro, cozinha)',
  'Esvaziar todas as lixeiras e sacos de lixo',
  'Limpar vidros, espelhos e portas de vidro',
  'Limpar balcao e area do bar (sem manchas)',
  'Limpar mesas, banquetas e cadeiras',
  'Piso sem marca alcool (salao inteiro)',
  'Limpeza vaso banheiro (sem marca, sujeira borda)',
  'Limpar pia e torneiras do banheiro',
  'Organizar copos, garrafas e utensilios no lugar',
  'Ventilacao / ar-condicionado ligado conforme padrao',
  'Verificacao pos-video (sujeira piso e vidros)',
  'Chave no keybox',
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
  'Atomic Bar': [...ATOMIC_BAR_ITEMS],
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

export function checklistTemplateForJob(job, deepComponents) {
  const catalogItems = getChecklistItems(job?.title || job?.location_name || '')
  const isDeep = getCleaningType(job) === 'deep'
  const comps = normalizeDeepComponents(
    deepComponents?.length ? deepComponents : (isDeep ? parseDeepComponents(job) : [])
  )
  const deepItems = comps.map(id => DEEP_COMPONENT_CHECKLIST[id]).filter(Boolean)
  const items = isDeep && deepItems.length
    ? [...catalogItems, ...deepItems]
    : catalogItems
  if (items.length) return items.join('\n')
  return (job?.checklist_template || '').trim()
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

/** Use in-memory checklist or build from job template */
export function resolveChecklistForJob(job, checklistState) {
  if (checklistState?.length) return checklistState
  return initChecklistState(job)
}
