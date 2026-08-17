import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function ContractTab({ employeeId, employeeName, emp, onApplied }) {
  const [contracts, setContracts] = useState([])
  const [uploading, setUploading] = useState(false)
  const [extracted, setExtracted] = useState(null)
  const [pendingFile, setPendingFile] = useState(null)

  useEffect(() => { load() }, [employeeId])

  const load = async () => {
    const { data, error } = await supabase.from('employee_contracts')
      .select('*').eq('employee_id', employeeId).order('uploaded_at', { ascending: false }).limit(5)
    if (error?.code === 'PGRST205') {
      if (emp?.notes) {
        try {
          const n = JSON.parse(emp.notes)
          if (n.contract_pdf) setContracts([{ id: 'local', file_name: 'Contrato', pdf_url: n.contract_pdf, uploaded_at: n.contract_applied_at, extraction_status: 'applied' }])
        } catch {}
      }
      return
    }
    if (!error) setContracts(data || [])
  }

  const handleFile = async (file) => {
    if (!file || file.type !== 'application/pdf') return toast.error('Envie um arquivo PDF')
    setUploading(true)
    setExtracted(null)
    setPendingFile(file)
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })

      const resp = await fetch('/api/extract-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfBase64: base64, fileName: file.name, employeeName }),
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setExtracted(data.extracted)
      toast.success('PDF lido pela IA — revise e aplique')
    } catch (e) {
      toast.error(e.message)
    }
    setUploading(false)
  }

  const applyExtraction = async () => {
    if (!extracted || !pendingFile) return
    setUploading(true)
    try {
      const path = `contracts/${employeeId}/contract_${Date.now()}.pdf`
      const { error: upErr } = await supabase.storage.from('service-photos').upload(path, pendingFile, { upsert: true })
      if (upErr) throw new Error(upErr.message)
      const { data: urlData } = supabase.storage.from('service-photos').getPublicUrl(path)

      const updates = {}
      if (extracted.full_name) updates.full_name = extracted.full_name
      if (extracted.contract_start) updates.contract_start = extracted.contract_start
      if (extracted.contract_end) updates.contract_end = extracted.contract_end
      if (extracted.contract_type) updates.contract_type = extracted.contract_type
      if (extracted.salary_type) updates.salary_type = extracted.salary_type
      if (extracted.fixed_salary) updates.fixed_salary = extracted.fixed_salary
      if (extracted.hourly_rate) updates.hourly_rate = extracted.hourly_rate
      if (extracted.job_bonus_rate) updates.job_bonus_rate = extracted.job_bonus_rate
      if (extracted.monthly_work_days) updates.monthly_work_days = extracted.monthly_work_days
      if (extracted.bank_name) updates.bank_name = extracted.bank_name
      if (extracted.bank_branch) updates.bank_branch = extracted.bank_branch
      if (extracted.account_type) updates.account_type = extracted.account_type
      if (extracted.account_number) updates.account_number = extracted.account_number
      if (extracted.account_holder_katakana) updates.account_holder_katakana = extracted.account_holder_katakana
      if (extracted.notes) updates.notes = extracted.notes

      const { error: empErr } = await supabase.from('employees').update(updates).eq('id', employeeId)
      if (empErr) throw empErr

      const contractRow = {
        employee_id: employeeId,
        employee_name: employeeName,
        pdf_url: urlData.publicUrl,
        file_name: pendingFile.name,
        extracted_json: extracted,
        retroactive_allowed: !!extracted.retroactive_allowed,
        extraction_status: 'applied',
        applied_at: new Date().toISOString(),
      }
      const { error: contractErr } = await supabase.from('employee_contracts').insert(contractRow)
      if (contractErr?.code === 'PGRST205') {
        await supabase.from('employees').update({
          notes: JSON.stringify({ contract_pdf: urlData.publicUrl, contract_data: extracted, retroactive_allowed: !!extracted.retroactive_allowed }),
        }).eq('id', employeeId)
      } else if (contractErr) throw contractErr

      toast.success('Contrato aplicado ao perfil!')
      setExtracted(null)
      setPendingFile(null)
      load()
      onApplied?.()
    } catch (e) {
      toast.error(e.message)
    }
    setUploading(false)
  }

  const fields = extracted ? [
    ['Nome', extracted.full_name], ['Início', extracted.contract_start], ['Fim', extracted.contract_end || 'Aberto'],
    ['Tipo contrato', extracted.contract_type], ['Salário', extracted.salary_type],
    ['Fixo/mês', extracted.fixed_salary ? `¥${Number(extracted.fixed_salary).toLocaleString()}` : '—'],
    ['Hora', extracted.hourly_rate ? `¥${extracted.hourly_rate}/h` : '—'],
    ['Bônus/job', extracted.job_bonus_rate ? `${extracted.job_bonus_rate}%` : '—'],
    ['Banco', extracted.bank_name], ['Agência', extracted.bank_branch],
    ['Conta', extracted.account_number], ['Titular', extracted.account_holder_katakana],
    ['Serviço', extracted.service_description], ['Retro permitido', extracted.retroactive_allowed ? 'Sim' : 'Não'],
    ['Confiança IA', extracted.confidence],
  ] : []

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">📄 Contrato PDF + IA</div>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
          Envie o PDF do contrato. A IA lê data de início, salário, banco e serviço — você revisa e aplica.
        </p>
        <label className="btn btn-primary" style={{ cursor: uploading ? 'wait' : 'pointer', display: 'inline-block' }}>
          {uploading ? '⏳ Analisando PDF...' : '📤 Enviar contrato PDF'}
          <input type="file" accept="application/pdf" style={{ display: 'none' }} disabled={uploading}
            onChange={e => handleFile(e.target.files?.[0])} />
        </label>
      </div>

      {extracted && (
        <div className="card" style={{ marginBottom: 14, border: '1px solid var(--navy)' }}>
          <div className="card-title">🤖 Dados extraídos — revise antes de aplicar</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {fields.map(([l, v]) => v && (
              <div key={l} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{String(v)}</div>
              </div>
            ))}
          </div>
          <button className="btn btn-primary" onClick={applyExtraction} disabled={uploading}>
            ✅ Aplicar ao perfil do funcionário
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">🏦 Dados bancários (depósito)</div>
        {emp?.bank_name ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {[['Banco', emp.bank_name], ['Agência', emp.bank_branch], ['Tipo', emp.account_type], ['Conta', emp.account_number], ['Titular', emp.account_holder_katakana]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--text3)' }}>{l}</span><span style={{ fontWeight: 500 }}>{v || '—'}</span>
              </div>
            ))}
          </div>
        ) : <div style={{ color: 'var(--text3)', fontSize: 13 }}>Sem dados bancários — envie o contrato PDF.</div>}
      </div>

      {contracts.length > 0 && (
        <div className="card">
          <div className="card-title">Histórico de contratos</div>
          {contracts.map(c => (
            <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.file_name || 'Contrato'}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(c.uploaded_at).toLocaleDateString('ja-JP')} · {c.extraction_status}</div>
              </div>
              {c.pdf_url && <a href={c.pdf_url} target="_blank" rel="noreferrer" className="btn btn-sm">📄 PDF</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
