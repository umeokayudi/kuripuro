import { useState } from 'react'
import AIChatPanel from './AIChatPanel'
import { useLang } from '../hooks/useLang'

export default function AIFloatingWidget({ mode = 'admin', employeeId, employeeName, dark = false }) {
  const [open, setOpen] = useState(false)
  const { tr } = useLang()
  const label = tr('Ask AI', 'AIに質問', 'Perguntar à IA')
  return <>
    {open && <div className="kp-ai-popover"><AIChatPanel compact mode={mode} employeeId={employeeId} employeeName={employeeName} dark={dark} /></div>}
    <button className="kp-ai-trigger" type="button" aria-label={open ? tr('Close AI assistant', 'AIを閉じる', 'Fechar assistente de IA') : label} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="kp-ai-trigger-icon">{open ? '×' : '✦'}</span><span className="kp-ai-trigger-label">{open ? tr('Close', '閉じる', 'Fechar') : label}</span>
    </button>
  </>
}
