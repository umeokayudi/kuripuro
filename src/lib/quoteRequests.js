import { supabase } from './supabase'

// v1.0.56 · Quote requests from the client portal that wait for the company price.
// Used by the admin topbar bell; the full list and the price form are in Client feedback → Requests.
export const QUOTE_REQUESTS_CHANGED = 'kp:quote-requests-changed'

export async function fetchPendingQuoteRequests() {
  const { data, error } = await supabase.from('client_requests')
    .select('id,client_id,location_name,category,description,created_at,quote_status')
    .eq('request_type', 'quote').or('quote_status.is.null,quote_status.eq.requested')
    .order('created_at', { ascending: false }).limit(50)
  if (error) throw error
  const rows = data || []
  const ids = [...new Set(rows.map(r => r.client_id).filter(Boolean))]
  if (!ids.length) return rows
  const { data: clients } = await supabase.from('clients').select('id,company_name').in('id', ids)
  const names = new Map((clients || []).map(c => [c.id, c.company_name]))
  return rows.map(r => ({ ...r, client_name: names.get(r.client_id) || '' }))
}
