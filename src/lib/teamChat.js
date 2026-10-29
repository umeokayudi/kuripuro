// v1.0.72 · Employee chat contacts: own leader, own team (when I lead someone), coworkers and the office.
// Employee ↔ employee messages live in team_messages; the office chat stays in messages.

export const OFFICE_KEY = 'office'

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** Messages with one coworker, oldest first, as { id, mine, content, created_at, read }. */
export function threadWith(teamMessages, meId, otherId) {
  return (teamMessages || [])
    .filter(m => (m.from_employee_id === meId && m.to_employee_id === otherId) || (m.from_employee_id === otherId && m.to_employee_id === meId))
    .map(m => ({ id: m.id, mine: m.from_employee_id === meId, content: m.content, created_at: m.created_at, read: m.read }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}

export function officeThread(messages) {
  return (messages || []).map(m => ({ id: m.id, mine: m.sender === 'employee', content: m.content, created_at: m.created_at, read: m.read }))
}

export function unreadFrom(teamMessages, meId, otherId) {
  return (teamMessages || []).filter(m => m.to_employee_id === meId && m.from_employee_id === otherId && !m.read).length
}

export function teamUnreadTotal(teamMessages, meId) {
  return (teamMessages || []).filter(m => m.to_employee_id === meId && !m.read).length
}

const byRecent = (a, b) => {
  const ta = a.last?.created_at || ''
  const tb = b.last?.created_at || ''
  if (ta !== tb) return tb.localeCompare(ta)
  return String(a.name).localeCompare(String(b.name))
}

/**
 * Sections shown in the employee chat list.
 * leader: the leader the admin set for me. team: people whose leader is me.
 * colleagues: every other active employee. office: the diretoria chat (only when the leader can't help).
 */
export function buildChatSections({ me, employees, teamMessages, officeMessages, teamReady }) {
  const meId = me?.id
  const self = (employees || []).find(x => x.id === meId)
  const leaderId = self?.leader_id || null
  const others = (employees || []).filter(x => x.id !== meId && x.is_active !== false)
  const contact = (emp, kind) => {
    const thread = threadWith(teamMessages, meId, emp.id)
    return { key: emp.id, kind, id: emp.id, name: emp.full_name || '—', role: emp.job_role || '', last: thread[thread.length - 1] || null, unread: unreadFrom(teamMessages, meId, emp.id) }
  }
  const office = officeThread(officeMessages)
  const officeContact = {
    key: OFFICE_KEY, kind: 'office', id: OFFICE_KEY, name: '', last: office[office.length - 1] || null,
    unread: (officeMessages || []).filter(m => m.sender === 'admin' && !m.read).length,
  }
  if (!teamReady) return { leader: null, team: [], colleagues: [], office: officeContact, leaderId: null }
  const leaderEmp = leaderId ? others.find(x => x.id === leaderId) : null
  const team = others.filter(x => x.leader_id === meId && x.id !== leaderId).map(x => contact(x, 'team')).sort(byRecent)
  const teamIds = new Set(team.map(x => x.id))
  // v1.0.90 · only the office and the own leader to start a chat; other coworkers show up only when a chat already exists.
  const colleagues = others.filter(x => x.id !== leaderId && !teamIds.has(x.id)).map(x => contact(x, 'colleague')).filter(c => c.last).sort(byRecent)
  return { leader: leaderEmp ? contact(leaderEmp, 'leader') : null, team, colleagues, office: officeContact, leaderId }
}
