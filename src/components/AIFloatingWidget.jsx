import { useState } from 'react'
import AIChatPanel from './AIChatPanel'
import { useLang } from '../hooks/useLang'

export default function AIFloatingWidget({ mode = 'admin', employeeId, employeeName, dark = false }) {
  const [open, setOpen] = useState(false)
  const { lang } = useLang()
  const label = lang === 'ja' ? 'AIに質問' : 'Ask AI'
  return <>
    {open && <div className="kp-ai-popover"><AIChatPanel compact mode={mode} employeeId={employeeId} employeeName={employeeName} dark={dark} /></div>}
    <button className="kp-ai-trigger" type="button" aria-label={open ? (lang === 'ja' ? 'AIを閉じる' : 'Close AI assistant') : label} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="kp-ai-trigger-icon">{open ? '×' : '✦'}</span><span className="kp-ai-trigger-label">{open ? (lang === 'ja' ? '閉じる' : 'Close') : label}</span>
    </button>
  </>
}
