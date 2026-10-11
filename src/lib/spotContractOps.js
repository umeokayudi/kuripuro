import { supabase } from './supabase'
import { buildSpotContractRow, spotInvoiceRows, emptySpotContractForm, contractPrefillFromClient, spotContractHtml } from './spotContract'
import { signatureForDisplay } from './signature'
import { uploadContractPdf } from './uploadPhoto'
import { viewablePhotoUrl } from './photoUrl'

// Database steps shared by Jobs (New Job / spot list) and Contracts → Spot contracts.

/** Creates the draft invoice (faturas + item) due on the contract's payment day and links it. */
export async function createSpotInvoice(contract) {
  const { fatura, item } = spotInvoiceRows(contract)
  const { data: f, error } = await supabase.from('faturas').insert(fatura).select('id,due_date').single()
  if (error) throw error
  const { error: itemErr } = await supabase.from('fatura_items').insert({ ...item, fatura_id: f.id })
  if (itemErr) throw itemErr
  await supabase.from('spot_contracts').update({ fatura_id: f.id }).eq('id', contract.id)
  return f
}

/** Saves a contract row and its invoice. Returns { contract, invoice, invoiceError }. */
export async function saveSpotContractWithInvoice(row) {
  const { data: contract, error } = await supabase.from('spot_contracts').insert(row).select().single()
  if (error) throw error
  // The PDF copy is saved in the background once the invoice is linked.
  try {
    const invoice = await createSpotInvoice(contract)
    const pdf = refreshSpotContractPdf(contract.id)
    return { contract: { ...contract, fatura_id: invoice.id }, invoice, pdf }
  } catch (invoiceError) {
    const pdf = refreshSpotContractPdf(contract.id)
    return { contract, invoice: null, invoiceError, pdf }
  }
}

/** "Generate contract" for a spot job that has none (uses the job's data and its client). */
export async function generateContractForJob(job) {
  const { data: client } = job.client_id
    ? await supabase.from('clients').select('*').eq('id', job.client_id).maybeSingle()
    : { data: null }
  const form = {
    title: String(job.title || '').split(' — ')[0], client_id: job.client_id, employee_id: job.employee_id,
    scheduled_date: job.scheduled_date, scheduled_time: job.scheduled_time, address: job.address,
    value: job.value, spot_value: job.spot_value, description: job.description, checklist_template: job.checklist_template, location_id: '',
  }
  const contract = { ...emptySpotContractForm(), ...contractPrefillFromClient(client), price: job.value || '' }
  const row = buildSpotContractRow({ contract, job, form, client, employee: { full_name: job.employee_name } })
  return saveSpotContractWithInvoice(row)
}

/**
 * Renders the 業務委託契約書 as an A4 PDF, stores it and records it on the contract row.
 * table 'spot_contracts' → pdf_path/pdf_saved_at; 'service_contracts' → contract_pdf_path/contract_pdf_saved_at.
 * `contract` is spot-contract shaped (recurringToContract for fixed locations); `id` is the row id.
 */
export async function saveContractPdf(contract, { table = 'spot_contracts', id = contract.id } = {}) {
  const { contractPdfBlob } = await import('./contractPdf')
  const sig = contract.signature_url ? await signatureForDisplay(contract.signature_url) : ''
  const blob = await contractPdfBlob(spotContractHtml(contract, 'ja', sig), { footer: contract.contract_number || '' })
  const name = String(contract.contract_number || 'contract').replace(/[^\w.-]/g, '_')
  const path = await uploadContractPdf(`jobs/contracts/${id}/${name}.pdf`, blob)
  const savedAt = new Date().toISOString()
  const patch = table === 'spot_contracts' ? { pdf_path: path, pdf_saved_at: savedAt } : { contract_pdf_path: path, contract_pdf_saved_at: savedAt }
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) throw error
  return { path, savedAt, blob }
}

/** Browser URL of a saved contract PDF (cache-busted by the save time). */
export function contractPdfUrl(path, savedAt) {
  const url = viewablePhotoUrl(path)
  return url && savedAt ? `${url}&v=${encodeURIComponent(savedAt)}` : url
}

/** Loads the current row and re-saves its PDF; never throws (the PDF is a copy, the row is the truth). */
export async function refreshSpotContractPdf(id) {
  try {
    const { data } = await supabase.from('spot_contracts').select('*').eq('id', id).single()
    if (data) return await saveContractPdf(data)
  } catch (err) {
    console.warn('contract PDF not saved', err)
  }
  return null
}
