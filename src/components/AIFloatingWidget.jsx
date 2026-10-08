import { useState } from 'react'
import AIChatPanel from './AIChatPanel'
import { useLang } from '../hooks/useLang'

export default function AIFloatingWidget({ mode = 'admin', employeeId, employeeName, dark = false }) {
  const [open, setOpen] = useState(false)
  const { lang } = useLang()
  const label = lang === 'ja' ? 'AIに質問' : 'Perguntar à IA'
  return <>
    {open && <div className="kp-ai-popover"><AIChatPanel compact mode={mode} employeeId={employeeId} employeeName={employeeName} dark={dark} /></div>}
    <button className="kp-ai-trigger" type="button" aria-label={open ? (lang === 'ja' ? 'AIを閉じる' : 'Fechar assistente de IA') : label} aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <span className="kp-ai-trigger-icon">{open ? '×' : '✦'}</span><span>{open ? (lang === 'ja' ? '閉じる' : 'Fechar') : label}</span>
    </button>
  </>
}
