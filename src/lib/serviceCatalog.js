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
export const DEFAULT_DEEP_CLEAN_PRICE = 5000

export const OTP_BASIC_LOCATIONS = [
  { name: 'Ibushio', address: 'https://www.google.com/maps/place/%E3%80%92105-0004+Tokyo,+Minato+City,+Shinbashi,+3+Chome%E2%88%9216%E2%88%9210+2F+%E7%87%BB%E7%94%B7/data=!4m2!3m1!1s0x60188bea2243a255:0x3335729416b3d811!18m1!1e1', notes: 'Key box: 0315', days: MON_SAT, pricePerVisit: 1923, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Nyu Ibushio', address: 'https://www.google.com/maps/place/%E3%80%92105-0004+Tokyo,+Minato+City,+Shinbashi,+4+Chome%E2%88%9214%E2%88%9214+1AUN%E3%83%93%E3%83%AB+2%E9%9A%8E+%E7%87%BB%E8%A3%BD%C3%97%E3%83%8F%E3%82%A4%E3%83%9C%E3%83%BC%E3%83%AB+%E3%83%8B%E3%83%A5%E3%83%BC%E3%82%A4%E3%83%96%E3%82%B7%E3%82%AA+%E6%96%B0%E6%A9%8B/data=!4m2!3m1!1s0x60188b03ade593e1:0x97fecfa767905aa0!18m1!1e1', notes: 'Key box: 0625', days: TUE_SUN, pricePerVisit: 1923, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Horumon no Manmosu', address: 'https://www.google.com/maps/place/Hormonal+Mammoth,+AUN%E3%83%93%E3%83%AB+3%E9%9A%8E+4+Chome-14-1+Shinbashi,+Minato+City,+Tokyo+105-0004/data=!4m2!3m1!1s0x60188b00378ec33d:0x5bcc2d79007831e2!18m1!1e1', notes: 'Key box: 4840', days: TUE_SUN, pricePerVisit: 1923, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Yakiniku Otoko Manmosu', address: 'https://www.google.com/maps/search/?api=1&query=%E7%84%BC%E8%82%89%E7%94%B7%E3%83%9E%E3%83%B3%E3%83%A2%E3%82%B9%20%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%B8%AF%E5%8C%BA%E6%96%B0%E6%A9%8B3-19-4', notes: 'Key box: 0601', days: TUE_SUN, pricePerVisit: 1923, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Nyu Sakana Yakio', address: 'https://www.google.com/maps/place/%E3%80%92105-0004+Tokyo,+Minato+City,+Shinbashi,+4+Chome%E2%88%9214%E2%88%921+AUN%E3%83%93%E3%83%AB+B1F,1F+%E3%83%8B%E3%83%A5%E3%83%BC%E3%82%B5%E3%82%AB%E3%83%8A%E3%83%A4%E3%82%AD%E3%82%AA/data=!4m2!3m1!1s0x60188bf114c1be87:0xb3de1028c1566a9c!18m1!1e1', notes: 'Key box B1: 1209', days: ALL_DAYS, pricePerVisit: 4000, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Kodama Shinbashi', address: 'https://www.google.com/maps/place/Uogosho+Kodama+The+Great+Fish+Merchant,+1F+A+4+Chome-19-10+Shinbashi,+Minato+City,+Tokyo+105-0004/data=!4m2!3m1!1s0x60188bc3da4fd7cd:0x2eaff7292663c436!18m1!1e1', notes: 'Key box: 0606', days: ALL_DAYS, pricePerVisit: 4000, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Kodama Kinshicho', address: 'https://www.google.com/maps/place/%E3%80%92130-0022+Tokyo,+Sumida+City,+Kotobashi,+3+Chome%E2%88%9213%E2%88%928+1F%E3%83%BBB+1F+%E9%AD%9A%E8%B1%AA%E5%95%86%E3%82%B3%E3%83%80%E3%83%9E%E9%8C%A6%E7%B8%84%E7%94%BA/data=!4m2!3m1!1s0x60188940d455d1d1:0xa93f3cb57bf2538c!18m1!1e1', notes: 'Key box: 5493', days: ALL_DAYS, pricePerVisit: 4000, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Kodama Oimachi', address: 'https://www.google.com/maps/place/%E3%80%92140-0014+Tokyo,+Shinagawa+City,+%C5%8Ci,+1+Chome%E2%88%921%E2%88%926+%E9%AD%9A%E8%B1%AA%E5%95%86%E3%82%B3%E3%83%80%E3%83%9E+%E5%A4%A7%E4%BA%95%E7%94%BA/data=!4m2!3m1!1s0x60188b00118ea4e5:0x6ed429ae566bfe38!18m1!1e1', notes: 'Key box: 3110', days: TUE_SUN, pricePerVisit: 3846, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Kodama Yurakucho', address: '', notes: 'Key box: TBD', days: TUE_SUN, pricePerVisit: 4000, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Sakana Yakio Honten', address: 'https://www.google.com/maps/place/SakanaYakio,+B%EF%BC%91F+3+Chome-5-13+Shinbashi,+Minato+City,+Tokyo+105-0004/data=!4m2!3m1!1s0x60188beb0ae5766b:0xf7e9e445dd3b5547!18m1!1e1', notes: 'Key box: 0919', days: MON_SAT, pricePerVisit: 3846, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Sakana Yakio 2', address: 'https://www.google.com/maps/place/Grilled+fish+man+2,+%E7%B2%BE%E5%B7%A5%E3%83%93%E3%83%AB+B1F+3+Chome-15-8+Shinbashi,+Minato+City,+Tokyo+105-0004/data=!4m2!3m1!1s0x60188b4ced1633f7:0x79eb1647925ac1ff!18m1!1e1', notes: 'Key box: 0808', days: MON_SAT, pricePerVisit: 3846, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
  { name: 'Tooda', address: 'https://www.google.com/maps/search/?api=1&query=%E9%AD%9A%E7%84%A1%E5%8F%8C%E3%83%88%E3%82%AA%E3%83%80%20%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%B8%AF%E5%8C%BA%E6%96%B0%E6%A9%8B4-15-6', notes: 'Key box: 5493', days: MON_SAT, pricePerVisit: 3846, deepCleanPrice: DEFAULT_DEEP_CLEAN_PRICE },
]

export const ATOMIC_LOCATION = {
  name: 'Atomic Bar',
  address: 'https://www.google.com/maps/search/?api=1&query=ATOMIC%20BAR%20%E5%85%AD%E6%9C%AC%E6%9C%A83-14-14%205F%20%E6%9D%B1%E4%BA%AC',
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
