import { supabase } from './supabase'
import { quoteInvoiceSource } from './quoteFlow'
import { invoiceDisplay, buildInvoicePrintHtml } from './invoicePrint'

/** Lines + totals to show for one invoice (the accepted 見積's lines when it came from one). */
export async function loadInvoiceView(f) {
  const [{ data: items }, { data: sc }] = await Promise.all([
    supabase.from('fatura_items').select('*').eq('fatura_id', f.id),
    supabase.from('spot_contracts').select('contract_details').eq('fatura_id', f.id).limit(1).maybeSingle(),
  ])
  const quote = await quoteInvoiceSource(sc?.contract_details?.quote_ref).catch(() => null)
  return invoiceDisplay(f, items || [], quote)
}

/** Opens the A4 請求書 (same layout as the 見積書) and the print dialog. */
export async function printInvoiceDoc(f, lang = 'ja') {
  const w = window.open('', '_blank')
  const [view, { data: client }] = await Promise.all([
    loadInvoiceView(f),
    f.client_id ? supabase.from('clients').select('company_name,address').eq('id', f.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!w) return
  w.document.write(buildInvoicePrintHtml(f, view, { client, lang }))
  w.document.close()
  setTimeout(() => { try { w.focus(); w.print() } catch { /* closed */ } }, 300)
}
