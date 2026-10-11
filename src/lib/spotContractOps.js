import { supabase } from './supabase'
import { buildSpotContractRow, spotInvoiceRows, emptySpotContractForm, contractPrefillFromClient } from './spotContract'

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
  try {
    const invoice = await createSpotInvoice(contract)
    return { contract: { ...contract, fatura_id: invoice.id }, invoice }
  } catch (invoiceError) {
    return { contract, invoice: null, invoiceError }
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
