// Unresolved items per admin menu entry: the sidebar shows each number until it is dealt with.
import { supabase } from './supabase'
import { countPendingTimeOff } from './timeOff'

export const PENDING_CHANGED = 'kp-pending-changed'

/** Call after resolving something so the menu numbers refresh right away. */
export function pendingChanged() {
  try { window.dispatchEvent(new Event(PENDING_CHANGED)) } catch { /* SSR */ }
}

// count(*) with filters; a missing table or column just counts as 0.
async function count(table, apply) {
  try {
    const { count: n, error } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }))
    return error ? 0 : (n || 0)
  } catch { return 0 }
}

export async function fetchPendingCounts(today) {
  const [
    timeOff, payroll, equipment, transport, salaryIssues,
    quotes, serviceRequests, complaints, empMsgs, clientMsgs,
  ] = await Promise.all([
    countPendingTimeOff(today),
    count('salary_periods', q => q.eq('status', 'auto_closed')),
    count('equipment_requests', q => q.eq('status', 'pending')),
    count('transport_claims', q => q.eq('status', 'pending')),
    count('salary_complaints', q => q.eq('status', 'pending')),
    // Client asked for a quote and has no price yet
    count('client_requests', q => q.eq('request_type', 'quote').eq('quote_status', 'requested').neq('status', 'completed')),
    count('client_requests', q => q.eq('status', 'pending').or('request_type.is.null,request_type.neq.quote')),
    count('client_complaints', q => q.neq('status', 'resolved')),
    count('messages', q => q.eq('sender', 'employee').eq('read', false)),
    count('client_messages', q => q.eq('sender', 'client').eq('read', false)),
  ])
  return {
    employees: timeOff,
    payrollClose: payroll,
    equipmentRequests: equipment,
    transport,
    salaryIssues,
    mitsumori: quotes,
    clientFeedback: serviceRequests + complaints,
    chat: empMsgs + clientMsgs,
  }
}
