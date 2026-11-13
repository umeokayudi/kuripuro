// v1.0.256 · real On The Planet service_contracts as saved on 2026-11-13 (read-only snapshot, no ids) — used by test-store-billing.mjs
// [location, billing(f/p), price, fixed, visits, monthly_revenue, active]
const R=[
['Horumon no Manmosu','p',6600,0,2,13200,0],['Horumon no Manmosu - Deep Clean','p',0,0,4,0,0],['Horumon no Manmosu — AC Cleaning','p',5000,0,1,5000,0],['Horumon no Manmosu — Grease Trap','p',5000,0,2,10000,0],['Horumon no Manmosu — Grill Cleaning','p',5000,0,1,5000,0],['Horumon no Manmosu — Range Hood','p',5000,0,1,5000,0],['Horumon no Manmosu — Stove','p',5000,0,1,5000,0],
['Ibushio','p',8250,0,2,16500,1],['Ibushio - Deep Clean','p',7000,0,4,28000,1],['Ibushio — AC Cleaning','p',5000,0,1,5000,1],['Ibushio — Grease Trap','p',5000,0,2,10000,1],['Ibushio — Grill Cleaning','p',5000,0,1,5000,1],['Ibushio — Range Hood','p',5000,0,1,5000,1],['Ibushio — Stove','p',5000,0,1,5000,1],
['Kodama Kinshicho','f',4400,120000,30,120000,1],['Kodama Kinshicho - Deep Clean','p',5000,0,4,20000,1],
['Kodama Oimachi','f',4231,100000,26,100000,1],['Kodama Oimachi - Deep Clean','p',5000,0,4,20000,1],
['Kodama Shinbashi','f',4400,120000,30,120000,1],['Kodama Shinbashi - Deep Clean','p',5000,0,4,20000,1],
['Kodama Yurakucho','f',4231,100000,26,100000,1],
['Nyu Ibushio','p',8250,0,2,16500,1],['Nyu Ibushio - Deep Clean','p',5000,0,4,20000,1],['Nyu Ibushio — AC Cleaning','p',5000,0,1,5000,1],['Nyu Ibushio — Grease Trap','p',5000,0,2,10000,1],['Nyu Ibushio — Grill Cleaning','p',5000,0,1,5000,1],['Nyu Ibushio — Range Hood','p',5000,0,1,5000,1],['Nyu Ibushio — Stove','p',5000,0,1,5000,1],
['Nyu Sakana Yakio','f',4400,120000,30,120000,1],['Nyu Sakana Yakio - Deep Clean','p',5000,0,4,20000,1],
['OTP — AC Cleaning','p',5000,0,0,0,1],['OTP — Floor Wax','p',5000,0,0,0,1],['OTP — Garbage Collection','p',5000,0,0,0,1],['OTP — Grease Trap','p',5000,0,0,0,1],['OTP — Grill Cleaning','p',5000,0,0,0,1],['OTP — Pest Control','p',5000,0,0,0,1],['OTP — Range Hood','p',5000,0,0,0,1],
['Sakana Yakio 2','f',4231,100000,26,100000,1],['Sakana Yakio 2 - Deep Clean','p',5000,0,4,20000,1],
['Sakana Yakio Honten','f',4231,100000,26,100000,1],['Sakana Yakio Honten - Deep Clean','p',5000,0,4,20000,1],
['Tooda','f',4231,100000,26,100000,1],['Tooda - Deep Clean','p',5000,0,4,20000,1],
['Yakiniku Otoko Manmosu','p',4400,0,2,8800,1],['Yakiniku Otoko Manmosu - Deep Clean','p',5000,0,4,20000,1],['Yakiniku Otoko Manmosu — AC Cleaning','p',5000,0,1,5000,1],['Yakiniku Otoko Manmosu — Grease Trap','p',5000,0,2,10000,1],['Yakiniku Otoko Manmosu — Grill Cleaning','p',5000,0,1,5000,1],['Yakiniku Otoko Manmosu — Range Hood','p',5000,0,1,5000,1],['Yakiniku Otoko Manmosu — Stove','p',5000,0,1,5000,1],
]
const ALL7=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], SUN6=['Sun','Tue','Wed','Thu','Fri','Sat'], MON6=['Mon','Tue','Wed','Thu','Fri','Sat']
const DAYS={'Kodama Kinshicho':ALL7,'Kodama Shinbashi':ALL7,'Nyu Sakana Yakio':ALL7,'Kodama Oimachi':SUN6,'Kodama Yurakucho':SUN6,'Sakana Yakio 2':MON6,'Sakana Yakio Honten':MON6,'Tooda':MON6}
export const contracts=R.map(([l,b,p,f,v,m,a])=>({client_id:'otp',location_name:l,billing_type:b==='f'?'fixed_monthly':'per_visit',price_per_visit:p,fixed_monthly:f,visits_per_month:v,monthly_revenue:m,discount_percent:0,is_active:!!a,service_type:l.includes('Deep Clean')?'Range Hood + AC + Grating + Grease Trap':'Basic Cleaning',days_of_week:DAYS[l]||(v?((/^Ibushio( —|$)/.test(l))?['Sun']:['Mon']):[])}))

/** The owner's fixed monthly model (2026-11-13) applied to the same rows — what the data change would save:
 * stores with a fixed item keep it; Ibushio / Nyu Ibushio / Yakiniku Otoko Manmosu main item → fixed ¥15.000 /
 * ¥15.000 / ¥8.000; every other scheduled item (Deep Clean and its parts) → ¥0/month (operational, inside the fixed). */
export const FIXED_BY_MAIN = { 'Ibushio': 15000, 'Nyu Ibushio': 15000, 'Yakiniku Otoko Manmosu': 8000 }
export const afterDataChange = contracts.map(c => {
  if (FIXED_BY_MAIN[c.location_name] != null) return { ...c, billing_type: 'fixed_monthly', fixed_monthly: FIXED_BY_MAIN[c.location_name], monthly_revenue: FIXED_BY_MAIN[c.location_name] }
  if (c.billing_type === 'fixed_monthly' || !c.visits_per_month) return c
  return { ...c, monthly_revenue: 0 }
})
