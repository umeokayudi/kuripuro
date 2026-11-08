#!/usr/bin/env node
// v1.0.167 · Deep Cleaning of the month: store × item × times, one job never counted twice, spot fills one item.
import { deepMonthProgress, deepSubtypes } from '../src/lib/deepMonthProgress.js'
const C='otp'
const k=(location_name,service_type,days,v,notes='')=>({id:location_name,client_id:C,location_name,service_type,days_of_week:days,visits_per_month:v,notes,is_active:true})
const contracts=[
 k('Ibushio - Deep Clean','Range Hood + AC + Grating + Grease Trap x2',['Mon'],4),
 k('Ibushio','Deep Cleaning (Grease Trap 2x, AC, Range Hood, Fogão)',['Sun'],2),
 k('Ibushio — Grease Trap','Grease Trap',['Sun'],2), k('Ibushio — Stove','Stove',['Sun'],1), k('Ibushio — Grill Cleaning','Grill Cleaning',['Sun'],1),
 k('Kodama Kinshicho','Basic Cleaning',['Mon'],30),
 k('Kodama Kinshicho - Deep Clean','Range Hood + AC + Grating + Grease Trap',['Mon'],4),
 k('Nyu Sakana Yakio - Deep Clean','Range Hood + AC + Grating + Grease Trap',['Mon'],4),
 k('OTP — Grease Trap','Grease Trap',[],0,'2x por mês. Grease trap'), k('OTP — AC Cleaning','AC Cleaning',[],0,'1x por mês.'),
 k('OTP — Floor Wax','Floor Wax',[],0,'3x por ano'), k('OTP — Grill Cleaning','Grill Cleaning',[],0,'1x por mês. Grelha'),
]
const j=(title,d,status,cat='regular')=>({id:title+d,title,scheduled_date:d,status,client_id:C,employee_name:'X',employee_id:'e',job_category:cat})
const jobs=[
 j('Ibushio - Deep Clean — グリストラップ','2026-11-05','completed','spot'),
 j('Ibushio — Deep Clean (Range Hood, Grease Trap, Grating, Stove, AC Cleaning)','2026-11-08','assigned'),
 j('Ibushio — Deep Clean (Grease Trap, Grating)','2026-11-22','assigned'),
 j('Kodama Kinshicho — Deep Clean (Grease Trap)','2026-11-03','completed'),
 j('Kodama Kinshicho — Basic Cleaning','2026-11-03','completed'),
 j('Nyu Sakana Yakio — Deep Clean (AC Cleaning, Grating, Other)','2026-11-04','completed'),
 j('Nyu Sakana Yakio — Deep Clean (Grease Trap)','2026-11-03','cancelled'),
 j('Nyu Sakana Yakio — Deep Clean (AC Cleaning)','2026-11-07','assigned'),
 j('Kodama Yurakucho — Deep Clean (Grease Trap)','2026-11-11','assigned'),
]
const r=deepMonthProgress(contracts,[{id:C,company_name:'On The Planet'}],jobs)
const assert = (c, m) => { if (!c) throw new Error(m) }
const otp = r[0]
const by = Object.fromEntries(otp.stores.map(s => [s.name, s]))
const it = (s, id) => by[s].items.find(i => i.id === id)
assert(!by.OTP, 'generic OTP items are not a store')
assert(!by['Kodama Yurakucho'], 'store without a deep contract is not expected')
assert(by.Ibushio.totals.expected === 6, 'Ibushio: 3 contract rows merged into 6 items (GT 2x)')
assert(it('Ibushio', 'grease_trap').done === 1 && it('Ibushio', 'grease_trap').scheduled === 1, 'spot fills one grease trap slot')
assert(by['Kodama Kinshicho'].totals.expected === 5 && it('Kodama Kinshicho', 'grease_trap').times === 2, 'generic 2x/mês applies to the store')
assert(it('Nyu Sakana Yakio', 'grease_trap').missing === 2, 'cancelled job goes back to missing')
assert(it('Nyu Sakana Yakio', 'ac').done === 1 && it('Nyu Sakana Yakio', 'ac').jobs.length === 1, 'surplus AC job not counted twice')
assert(otp.extras.length === 3, 'extras = jobs outside the expected items')
assert(otp.totals.expected === 16 && otp.totals.done === 4 && otp.totals.scheduled === 5 && otp.totals.missing === 7, 'totals ' + JSON.stringify(otp.totals))
console.log('deep month progress OK', JSON.stringify(otp.totals))
