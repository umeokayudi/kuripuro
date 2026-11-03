// Run: npx esbuild scripts/test-client-report.mjs --bundle --platform=node --format=esm --outfile=/tmp/t.mjs && node /tmp/t.mjs
import { clientReportRows, clientReportHtml } from '../src/lib/clientReport.js'
const rows = clientReportRows([{status:'completed',scheduled_date:'2026-10-02',title:'Atomic Bar — Floor',employee_name:'Gabriel',scheduled_time:'22:00',notes:'secret',price:6000},{status:'assigned',scheduled_date:'2026-10-03',title:'X'}])
const h = clientReportHtml({clientName:'Atomic',from:'2026-10-01',to:'2026-10-31',rows,lang:'pt'})
console.log(rows.length===1, !h.includes('22:00'), !h.includes('secret'), !h.includes('6000'), h.includes('Gabriel'))
