/** Catálogo de serviços, dias de operação e clientes — fonte única de verdade */

export const SCHEDULE_CLIENTS = {
  ontheplanet: { id: '7138f082-0d38-43e4-bd77-00c4598690b3', name: 'On The Planet' },
  atomicbar: { id: 'bf3f7ab5-24c4-4ec1-b25f-d91becb166de', name: 'Atomic Bar' },
  duskin: { id: '88c3b288-d923-440d-9c67-2e420d1c0101', name: 'Duskin' },
  matsunaga: { id: 'b26a5a5d-ac05-4def-a876-2e725d8ebb4b', name: 'Matsunaga' },
}

const SUN = 0
const MON = 1
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]
const MON_SAT = [1, 2, 3, 4, 5, 6] // folga domingo
const TUE_SUN = [0, 2, 3, 4, 5, 6] // folga segunda

/** Limpeza básica diária — On The Planet */
export const OTP_BASIC_LOCATIONS = [
  { name: 'Ibushio', address: 'https://maps.app.goo.gl/xxDzKRfpJYpk2XtW6', notes: 'Key box: 0315', days: MON_SAT, pricePerVisit: 1923 },
  { name: 'Nyu Ibushio', address: 'https://maps.app.goo.gl/ZXqfCc5MNn1aicPHA', notes: 'Key box: 0625', days: TUE_SUN, pricePerVisit: 1923 },
  { name: 'Horumon no Manmosu', address: 'https://maps.app.goo.gl/r12jwNF7RpEFZTtA8', notes: 'Key box: 4840', days: TUE_SUN, pricePerVisit: 1923 },
  { name: 'Yakiniku Otoko Manmosu', address: 'https://maps.app.goo.gl/n8YnpXDyQXmuefJK7', notes: 'Key box: 0601', days: TUE_SUN, pricePerVisit: 1923 },
  { name: 'Nyu Sakana Yakio', address: 'https://maps.app.goo.gl/ig73pcZ4Gxff4kjU6', notes: 'Key box B1: 1209', days: ALL_DAYS, pricePerVisit: 4000 },
  { name: 'Kodama Shinbashi', address: 'https://maps.app.goo.gl/SFPkHjrQkJ3ie6x57', notes: 'Key box: 0606', days: ALL_DAYS, pricePerVisit: 4000 },
  { name: 'Kodama Kinshicho', address: 'https://maps.app.goo.gl/HseQiawXKs32KzNz7', notes: 'Key box: 5493', days: ALL_DAYS, pricePerVisit: 4000 },
  { name: 'Kodama Oimachi', address: 'https://maps.app.goo.gl/WZH9grtQtnPBvb9A6', notes: 'Key box: 3110', days: TUE_SUN, pricePerVisit: 3846 },
  { name: 'Kodama Yurakucho', address: '', notes: 'Key box: TBD', days: TUE_SUN, pricePerVisit: 4000 },
  { name: 'Sakana Yakio Honten', address: 'https://maps.app.goo.gl/w9QHq1rX97N4J73d7', notes: 'Key box: 0919', days: MON_SAT, pricePerVisit: 3846 },
  { name: 'Sakana Yakio 2', address: 'https://maps.app.goo.gl/Kxrk58ofn6465Yew8', notes: 'Key box: 0808', days: MON_SAT, pricePerVisit: 3846 },
  { name: 'Tooda', address: 'https://maps.app.goo.gl/u5WefsYvHS3qi6lZ9', notes: 'Key box: 5493', days: MON_SAT, pricePerVisit: 3846 },
]

export const ATOMIC_LOCATION = {
  name: 'Atomic Bar',
  address: 'https://share.google/dGNoA7mGwHxRtZtnn',
  notes: 'Segunda-feira até 21:00',
  days: [MON],
  pricePerVisit: 37500,
  client: 'Atomic Bar',
  scheduledTime: '21:00',
}

/** Duskin — domingos especiais do mês */
export const DUSKIN_SITES = {
  sugitaTeiLamen: { name: 'Sugita Tei Lamen', notes: '1º dom: cera no chão + range hood' },
  sugitaRestaurant: { name: 'Sugita Restaurant', notes: '1º dom: polidora + banheiro; 3ª sem: polidora + range hood + banheiro' },
  building1: { name: 'Duskin Building 1 — Common Area', notes: 'Área comum + lixo' },
  building2: { name: 'Duskin Building 2 — Common Area', notes: 'Área comum + lixo' },
  building3: { name: 'Duskin Building 3 — Common Area', notes: 'Área comum + lixo' },
}

/** Matsunaga — somente spot (sem escala fixa) */
export const MATSUNAGA_SPOT = {
  name: 'Matsunaga',
  serviceType: 'Spot Cleaning',
  notes: 'Somente serviços spot — agendar manualmente',
}

/**
 * Manutenção periódica (inserir jobs manualmente / faturamento via contrato).
 * Não entra na escala automática de limpeza básica.
 */
export const MAINTENANCE_SERVICES = [
  { serviceType: 'Grease Trap', frequency: '2x por mês', notes: 'Grease trap — 2 vezes no mês' },
  { serviceType: 'AC Cleaning', frequency: '1x por mês', notes: 'Ar condicionado — 1 vez no mês' },
  { serviceType: 'Range Hood', frequency: '1x por mês', notes: 'Range hood — 1 vez no mês (fora do deep clean)' },
  { serviceType: 'Grill Cleaning', frequency: '1x por mês', notes: 'Grelha — 1 vez no mês' },
  { serviceType: 'Floor Wax', frequency: '3x por ano', notes: 'Polidora no piso — 3 vezes no ano' },
  { serviceType: 'Garbage Collection', frequency: 'quando necessário', notes: 'Coleta de lixo sob demanda' },
  { serviceType: 'Pest Control', frequency: 'quando necessário', notes: 'Dedetização de insetos sob demanda' },
]

export const DAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
export const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function daysToDowNames(days) {
  return days.map(d => DOW_EN[d]).filter(Boolean)
}

export function visitsPerMonth(days) {
  return Math.round(days.length * 4.33)
}

export function monthlyRevenue(pricePerVisit, days) {
  return Math.round(pricePerVisit * visitsPerMonth(days))
}

/** 7 dias na semana — na segunda limpam às 06:00 (depois do Atomic) */
export const SEVEN_DAY_MONDAY_MORNING = ['Nyu Sakana Yakio', 'Kodama Shinbashi', 'Kodama Kinshicho']
