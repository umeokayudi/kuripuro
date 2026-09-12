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

const CHECKLIST_DISPLAY = {
  'Lixo banheiro': { en: 'Bathroom trash', ja: 'トイレのゴミ' },
  'Limpeza vaso (sem marca, sujeira borda)': { en: 'Toilet clean (no marks on rim)', ja: '便器（縁の汚れなし）' },
  'Limpar tapete (lixo)': { en: 'Clean mat (trash)', ja: 'マットのゴミ' },
  'Piso sem marca alcool': { en: 'Floor with no alcohol marks', ja: '床にアルコール跡なし' },
  'Ventilacao ligada': { en: 'Ventilation on', ja: '換気オン' },
  'Ventilacao desligada': { en: 'Ventilation off', ja: '換気オフ' },
  'Lixo pas retirado': { en: 'Trash taken out', ja: 'ゴミを出した' },
  'Chave no keybox': { en: 'Key back in keybox', ja: 'キーボックスに鍵' },
  'Verificacao pos-video (sujeira piso)': { en: 'Post-video floor check', ja: '動画後の床確認' },
  'Coisas retiradas no lugar': { en: 'Moved items put back', ja: '動かした物を戻す' },
  'Luzes apagadas': { en: 'Lights off', ja: '消灯' },
  'Cadeiras abaixadas': { en: 'Chairs down', ja: '椅子を下ろす' },
  'Porta segundo andar fechada': { en: '2nd floor door closed', ja: '2階のドアを閉める' },
  'Retirar TODO o lixo (bar, salao, banheiro, cozinha)': { en: 'Remove ALL trash (bar, floor, restroom, kitchen)', ja: 'ゴミを全部出す（バー・フロア・トイレ・厨房）' },
  'Esvaziar todas as lixeiras e sacos de lixo': { en: 'Empty every bin and trash bag', ja: 'ゴミ箱と袋を空にする' },
  'Limpar vidros, espelhos e portas de vidro': { en: 'Clean glass, mirrors, and glass doors', ja: 'ガラス・鏡・ガラス扉' },
  'Limpar balcao e area do bar (sem manchas)': { en: 'Clean bar counter (no stains)', ja: 'バーカウンター（シミなし）' },
  'Limpar mesas, banquetas e cadeiras': { en: 'Clean tables, stools, and chairs', ja: 'テーブル・スツール・椅子' },
  'Piso sem marca alcool (salao inteiro)': { en: 'Floor with no alcohol marks (whole room)', ja: 'フロア全体にアルコール跡なし' },
  'Limpeza vaso banheiro (sem marca, sujeira borda)': { en: 'Restroom toilet (no marks on rim)', ja: 'トイレ便器（縁の汚れなし）' },
  'Limpar pia e torneiras do banheiro': { en: 'Clean restroom sink and taps', ja: '洗面台と水栓' },
  'Organizar copos, garrafas e utensilios no lugar': { en: 'Put glasses, bottles, and tools back', ja: 'グラス・ボトル・用具を戻す' },
  'Ventilacao / ar-condicionado ligado conforme padrao': { en: 'Ventilation / AC on as usual', ja: '換気・エアコンを通常どおり' },
  'Verificacao pos-video (sujeira piso e vidros)': { en: 'Post-video check (floor and glass)', ja: '動画後の床とガラス確認' },
  'Range Hood — limpeza completa (filtros, duto, superficie)': { en: 'Range Hood — full clean (filters, duct, surface)', ja: 'レンジフード — フィルター・ダクト・表面' },
  'AC Cleaning — filtros e unidade interna': { en: 'AC Cleaning — filters and indoor unit', ja: 'エアコン — フィルターと室内機' },
  'Grating — grelha limpa sem gordura': { en: 'Grating — clean, no grease', ja: 'グレーティング — 油なし' },
  'Grease Trap — esvaziado e higienizado': { en: 'Grease Trap — emptied and sanitized', ja: 'グリストラップ — 空にして清掃' },
  'Stove — fogões limpos e sem gordura': { en: 'Stove — clean, no grease', ja: 'コンロ — 油なし' },
}

export function checklistDisplayLabel(label, lang = 'en') {
  const row = CHECKLIST_DISPLAY[label]
  if (!row) return label
  return lang === 'ja' ? row.ja : row.en
}

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

/** Merge saved checklist ticks with the full template for this job (fixes partial localStorage). */
export function resolveChecklistForJob(job, checklistState) {
  const template = initChecklistState(job)
  if (!checklistState?.length) return template
  if (checklistState.length === template.length
    && checklistState.every((c, i) => c.label === template[i]?.label)) {
    return checklistState
  }
  const doneByLabel = Object.fromEntries(
    checklistState.filter(c => c.done).map(c => [c.label, true]),
  )
  return template.map(item => ({ ...item, done: !!doneByLabel[item.label] }))
}
