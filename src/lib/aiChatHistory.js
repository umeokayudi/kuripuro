const TTL_MS = 30 * 60 * 1000 // 30 minutos

function storageKey(mode, employeeId) {
  if (mode === 'employee' && employeeId) return `kp_ai_chat_employee_${employeeId}`
  return `kp_ai_chat_${mode || 'admin'}`
}

export function loadChatHistory(mode, employeeId, fallback) {
  try {
    const raw = sessionStorage.getItem(storageKey(mode, employeeId))
    if (!raw) return fallback
    const { savedAt, messages } = JSON.parse(raw)
    if (!savedAt || !Array.isArray(messages) || !messages.length) return fallback
    if (Date.now() - savedAt > TTL_MS) {
      sessionStorage.removeItem(storageKey(mode, employeeId))
      return fallback
    }
    return messages
  } catch {
    return fallback
  }
}

export function saveChatHistory(mode, employeeId, messages) {
  try {
    sessionStorage.setItem(storageKey(mode, employeeId), JSON.stringify({
      savedAt: Date.now(),
      messages,
    }))
  } catch {}
}

export function clearChatHistory(mode, employeeId) {
  try { sessionStorage.removeItem(storageKey(mode, employeeId)) } catch {}
}
