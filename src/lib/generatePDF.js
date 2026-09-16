import { jsPDF } from 'jspdf'
import { viewablePhotoUrl } from './photoUrl'
import { jobToServiceReport, fmtDuration } from './jobReport'

export function resolvePdfPhotoUrl(url) {
  if (!url) return null
  const view = viewablePhotoUrl(url)
  if (!view) return null
  if (view.startsWith('data:') || view.startsWith('blob:')) return view
  if (view.startsWith('/') && typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${view}`
  }
  return view
}

export function reportPdfFilename(report) {
  const loc = String(report?.client_name || report?.location_name || report?.job_title || 'report')
    .replace(/ — .*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  const date = report?.report_date || report?.scheduled_date || 'visit'
  return `report_${loc || 'visit'}_${date}.pdf`
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = src
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

async function blobToJpegDataUrl(blob) {
  let working = blob
  const type = (blob?.type || '').toLowerCase()
  const heic = type.includes('heic') || type.includes('heif')
  if (heic) {
    try {
      const { default: heic2any } = await import('heic2any')
      const converted = await heic2any({ blob: working, toType: 'image/jpeg', quality: 0.86 })
      working = Array.isArray(converted) ? converted[0] : converted
    } catch { /* canvas / FileReader fallback */ }
  }

  if (typeof document !== 'undefined') {
    const objectUrl = URL.createObjectURL(working)
    try {
      const img = await loadHtmlImage(objectUrl)
      const max = 1400
      let { width, height } = img
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, width)
      canvas.height = Math.max(1, height)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.86)
    } catch {
      /* fall through */
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  const mime = (working.type || '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg') || mime.includes('png')) {
    try {
      const buf = new Uint8Array(await working.arrayBuffer())
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < buf.length; i += chunk) {
        binary += String.fromCharCode(...buf.subarray(i, i + chunk))
      }
      const b64 = btoa(binary)
      const kind = mime.includes('png') ? 'png' : 'jpeg'
      return `data:image/${kind};base64,${b64}`
    } catch { /* FileReader fallback */ }
  }

  try {
    return await blobToDataUrl(working)
  } catch {
    return null
  }
}

/** Fetch a storage photo and convert it to a JPEG data URL that jsPDF can embed. */
export async function loadImageDataUrl(url) {
  if (!url) return null
  const candidates = []
  const resolved = resolvePdfPhotoUrl(url)
  if (resolved) candidates.push(resolved)
  if (url.startsWith('http') && url !== resolved) candidates.push(url)

  for (const src of candidates) {
    try {
      if (src.startsWith('data:image/')) return src
      const resp = await fetch(src)
      if (!resp.ok) continue
      const blob = await resp.blob()
      const jpeg = await blobToJpegDataUrl(blob)
      if (jpeg) return jpeg
    } catch { /* try next candidate */ }
  }
  return null
}

function drawPhotoSlot(doc, x, y, w, h, label, dataUrl, missingLabel) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(40, 40, 40)
  doc.text(label, x, y)
  const imgY = y + 4
  doc.setDrawColor(210)
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(x, imgY, w, h, 2, 2, 'FD')
  let drawn = false
  if (dataUrl) {
    try {
      const fmt = dataUrl.includes('image/png') ? 'PNG' : 'JPEG'
      doc.addImage(dataUrl, fmt, x, imgY, w, h)
      drawn = true
    } catch { drawn = false }
  }
  if (!drawn) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(140, 140, 140)
    doc.text(missingLabel || 'Photo unavailable', x + w / 2, imgY + h / 2, { align: 'center' })
  }
  return imgY + h + 8
}

function addPdfFooter(doc, L, lang) {
  const pageCount = doc.getNumberOfPages()
  const W = 210
  const margin = 14
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(6, 13, 24)
    doc.rect(0, 285, W, 12, 'F')
    doc.setTextColor(193, 156, 86)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(L.confidential, margin, 292)
    doc.text(`${L.generated}: ${new Date().toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-GB')}  ·  ${i}/${pageCount}`, W - margin, 292, { align: 'right' })
  }
}

function reportLabels(lang, extra = {}) {
  const ja = lang === 'ja'
  return {
    title: ja ? 'サービスレポート' : 'Service Report',
    employee: ja ? '担当者' : 'Employee',
    date: ja ? '日付' : 'Date',
    location: ja ? '店舗' : 'Location',
    start: ja ? '開始' : 'Start',
    end: ja ? '終了' : 'End',
    duration: ja ? '作業時間' : 'Duration',
    type: ja ? '種別' : 'Type',
    typeLive: ja ? 'リアルタイム' : 'Live',
    typeRetro: ja ? '遡及' : 'Retroactive',
    checklist: ja ? 'チェックリスト' : 'Checklist',
    notes: ja ? '作業メモ' : 'Service notes',
    photos: ja ? '作業写真' : 'Service photos',
    before: ja ? '作業前' : 'Before',
    after: ja ? '作業後' : 'After',
    signature: ja ? '署名' : 'Signature',
    photoUnavailable: ja ? '写真を読み込めませんでした' : 'Photo unavailable',
    noNotes: ja ? 'コメントなし' : 'No comments',
    generated: ja ? '作成' : 'Generated',
    confidential: ja ? 'KuriPuro by JBM — 社外秘' : 'KuriPuro by JBM — Confidential',
    ...extra,
  }
}

export async function generateServiceReportPdf(reportOrJob, { lang = 'en', labels } = {}) {
  const report = reportOrJob?.job_title || reportOrJob?.photo_before_url !== undefined || reportOrJob?.report_date
    ? reportOrJob
    : jobToServiceReport(reportOrJob, lang)
  const L = reportLabels(lang, labels)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const margin = 14
  let y = margin

  doc.setFillColor(6, 13, 24)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('KuriPuro by JBM', margin, 12)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text(L.title, margin, 20)
  const dateLabel = report.report_date || ''
  doc.text(dateLabel, W - margin, 20, { align: 'right' })
  y = 40

  const location = (report.client_name || report.location_name || report.job_title || '—').replace(/ — .*/, '')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(6, 13, 24)
  doc.text(location, margin, y)
  y += 7
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(80, 80, 80)
  doc.text(report.job_title || location, margin, y)
  y += 10

  const typeText = report.report_type === 'retroativo' ? L.typeRetro : L.typeLive
  const meta = [
    [L.employee, report.employee_name || '—'],
    [L.date, report.report_date || '—'],
    [L.start, report.time_in || '—'],
    [L.end, report.time_out || '—'],
    [L.duration, fmtDuration(report.duration_min, lang)],
    [L.type, typeText],
    [L.checklist, report.checklist_total ? `${report.checklist_done || 0}/${report.checklist_total}` : '—'],
  ]

  const colW = (W - margin * 2) / 2
  meta.forEach((pair, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + col * colW
    const yy = y + row * 12
    doc.setFillColor(245, 247, 252)
    doc.roundedRect(x, yy, colW - 4, 10, 1.5, 1.5, 'F')
    doc.setFontSize(7)
    doc.setTextColor(120, 120, 120)
    doc.text(pair[0], x + 3, yy + 3.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(40, 40, 40)
    doc.text(String(pair[1] || '—'), x + 3, yy + 8)
    doc.setFont('helvetica', 'normal')
  })
  y += Math.ceil(meta.length / 2) * 12 + 6

  const notes = report.notes_out || report.retro_ai_summary || ''
  if (y > 250) { doc.addPage(); y = margin }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(6, 13, 24)
  doc.text(L.notes, margin, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(50, 50, 50)
  const noteLines = doc.splitTextToSize(notes || L.noNotes, W - margin * 2)
  noteLines.forEach(line => {
    if (y > 270) { doc.addPage(); y = margin }
    doc.text(line, margin, y)
    y += 4.5
  })
  y += 6

  const beforeUrl = report.photo_before_url || report.photo_start_url
  const afterUrl = report.photo_after_url || report.photo_end_url
  const duringUrl = report.photo_during_url || null
  const signatureUrl = report.signature_url || null
  if (beforeUrl || afterUrl || duringUrl || signatureUrl) {
    doc.addPage()
    y = margin
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(6, 13, 24)
    doc.text(L.photos, margin, y)
    y += 8
    const pageW = W - margin * 2
    const slots = [
      beforeUrl && [L.before, beforeUrl],
      duringUrl && [L.during || 'During', duringUrl],
      afterUrl && [L.after, afterUrl],
      signatureUrl && [L.signature, signatureUrl],
    ].filter(Boolean)
    const imgH = slots.length > 2 ? 70 : 100
    for (const [label, url] of slots) {
      if (y + imgH > 275) {
        doc.addPage()
        y = margin
      }
      const data = await loadImageDataUrl(url)
      y = drawPhotoSlot(doc, margin, y, pageW, imgH, label, data, L.photoUnavailable)
    }
  }

  addPdfFooter(doc, L, lang)

  return doc
}

export function openPdfPreviewTab() {
  if (typeof window === 'undefined') return null
  try {
    const preview = window.open('', '_blank')
    if (preview?.document) {
      preview.document.write(
        '<p style="font-family:sans-serif;padding:24px;color:#555">Building PDF with photos…</p>',
      )
    }
    return preview
  } catch {
    return null
  }
}

export async function saveServiceReportPdf(reportOrJob, options = {}) {
  const lang = options.lang || 'en'
  const looksLikeReport = !!(reportOrJob?.job_title || reportOrJob?.report_date || reportOrJob?.photo_before_url !== undefined)
  const report = looksLikeReport ? reportOrJob : jobToServiceReport(reportOrJob, lang)
  const doc = await generateServiceReportPdf(report, { lang, labels: options.labels })
  const name = reportPdfFilename(report)
  const blob = doc.output('blob')
  const preview = options.previewWindow
  if (preview && !preview.closed && typeof URL !== 'undefined') {
    const url = URL.createObjectURL(blob)
    try { preview.location.href = url } catch { /* download still runs */ }
  }
  doc.save(name)
  return name
}


export async function generateDailyReport(date, jobs, employeeName) {
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
  const W = 210, margin = 14
  let y = margin

  // Header
  doc.setFillColor(6, 13, 24)
  doc.rect(0, 0, W, 30, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('KuriPuro by JBM', margin, 12)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Daily Service Report', margin, 20)
  doc.text(new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }), W - margin, 20, { align:'right' })
  y = 38

  // Info row
  doc.setTextColor(50, 50, 50)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Employee:', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(employeeName, margin + 24, y)
  doc.setFont('helvetica', 'bold')
  doc.text('Date:', 110, y)
  doc.setFont('helvetica', 'normal')
  doc.text(new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }), 122, y)
  y += 6

  // Summary bar
  const done = jobs.filter(j => j.status === 'completed').length
  const totalMins = jobs.reduce((s, j) => {
    if (!j.started_at || !j.completed_at) return s
    return s + (new Date(j.completed_at) - new Date(j.started_at)) / 60000
  }, 0)
  doc.setFillColor(240, 245, 255)
  doc.roundedRect(margin, y, W - margin*2, 18, 2, 2, 'F')
  doc.setTextColor(50, 50, 50)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text(`Locations completed: ${done}/${jobs.length}`, margin + 4, y + 7)
  doc.text(`Total time: ${Math.floor(totalMins/60)}h ${Math.round(totalMins%60)}m`, margin + 60, y + 7)
  doc.text(`Status: ${done === jobs.length ? '✓ COMPLETE' : 'INCOMPLETE'}`, margin + 120, y + 7)
  y += 24

  // Jobs table
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(6, 13, 24)
  doc.text('Service Log', margin, y)
  y += 5

  // Table header
  doc.setFillColor(6, 13, 24)
  doc.rect(margin, y, W - margin*2, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('#', margin + 2, y + 5)
  doc.text('Location', margin + 8, y + 5)
  doc.text('Check-in', margin + 90, y + 5)
  doc.text('Check-out', margin + 115, y + 5)
  doc.text('Duration', margin + 142, y + 5)
  doc.text('Status', margin + 164, y + 5)
  y += 9

  // Table rows
  jobs.forEach((j, idx) => {
    if (y > 260) { doc.addPage(); y = margin }
    const checkin = j.started_at ? new Date(j.started_at).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }) : '—'
    const checkout = j.completed_at ? new Date(j.completed_at).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }) : '—'
    const dur = j.started_at && j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 60000) + 'm' : '—'
    const isEven = idx % 2 === 0
    if (isEven) { doc.setFillColor(248, 250, 255); doc.rect(margin, y - 1, W - margin*2, 8, 'F') }
    doc.setTextColor(50, 50, 50)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(String(idx + 1), margin + 2, y + 5)
    const name = j.title.replace(/ — .*/,'').substring(0, 38)
    doc.text(name, margin + 8, y + 5)
    doc.text(checkin, margin + 90, y + 5)
    doc.text(checkout, margin + 115, y + 5)
    doc.text(dur, margin + 142, y + 5)
    if (j.status === 'completed') { doc.setTextColor(15, 110, 86); doc.setFont('helvetica', 'bold') }
    else { doc.setTextColor(200, 50, 50) }
    doc.text(j.status.toUpperCase(), margin + 164, y + 5)
    y += 8
  })

  // Notes section
  const jobsWithNotes = jobs.filter(j => j.notes_employee)
  if (jobsWithNotes.length > 0) {
    y += 6
    if (y > 250) { doc.addPage(); y = margin }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(6, 13, 24)
    doc.text('Service Notes', margin, y)
    y += 6
    jobsWithNotes.forEach(j => {
      if (y > 270) { doc.addPage(); y = margin }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(50, 50, 50)
      doc.text(j.title.replace(/ — .*/,'') + ':', margin, y)
      y += 4
      doc.setFont('helvetica', 'normal')
      const lines = doc.splitTextToSize(j.notes_employee, W - margin*2 - 4)
      lines.forEach(line => {
        if (y > 270) { doc.addPage(); y = margin }
        doc.text(line, margin + 4, y)
        y += 4
      })
      y += 2
    })
  }

  // Photos section
  const jobsWithPhotos = jobs.filter(j => j.photo_start_url || j.photo_end_url)
  if (jobsWithPhotos.length > 0) {
    doc.addPage(); y = margin
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(6, 13, 24)
    doc.text('Service Photos', margin, y)
    y += 8
    const imgW = 82, imgH = 60, gap = 6
    for (const j of jobsWithPhotos) {
      if (y > 220) { doc.addPage(); y = margin }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(50, 50, 50)
      doc.text(j.title.replace(/ — .*/,'').substring(0, 50), margin, y)
      y += 4
      let x = margin
      for (const [label, url] of [['Before', j.photo_start_url], ['After', j.photo_end_url]]) {
        if (!url) continue
        const data = await loadImageDataUrl(url)
        drawPhotoSlot(doc, x, y, imgW, imgH, label, data, 'Photo unavailable')
        x += imgW + gap
      }
      y += imgH + 16
    }
  }

  // Signature area
  y = Math.max(y + 10, 240)
  if (y > 265) { doc.addPage(); y = margin + 20 }
  doc.setDrawColor(180, 180, 180)
  doc.line(margin, y, margin + 70, y)
  doc.line(W - margin - 70, y, W - margin, y)
  doc.setFontSize(8)
  doc.setTextColor(120, 120, 120)
  doc.text('Employee Signature', margin, y + 5)
  doc.text('Admin Signature', W - margin - 70, y + 5)
  doc.text(employeeName, margin, y + 10)

  // Footer
  doc.setFillColor(6, 13, 24)
  doc.rect(0, 285, W, 12, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(7)
  doc.text('KuriPuro by JBM — Confidential', margin, 292)
  doc.text(`Generated: ${new Date().toLocaleString('ja-JP')}`, W - margin, 292, { align:'right' })

  return doc
}

export async function generatePayslip(employee, month, salaryData, payments, advances) {
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
  const W = 210, margin = 14
  let y = margin

  // Header
  doc.setFillColor(6, 13, 24)
  doc.rect(0, 0, W, 35, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text('KuriPuro by JBM', margin, 14)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('Monthly Payslip — 給与明細', margin, 23)
  doc.text(new Date(month + '-01').toLocaleString('en', { month:'long', year:'numeric' }), W - margin, 23, { align:'right' })
  y = 44

  // Employee info
  doc.setFillColor(245, 247, 255)
  doc.roundedRect(margin, y, W - margin*2, 24, 2, 2, 'F')
  doc.setTextColor(50, 50, 50)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Employee:', margin + 4, y + 8)
  doc.text('Contract:', margin + 4, y + 16)
  doc.setFont('helvetica', 'normal')
  doc.text(employee.full_name || '—', margin + 28, y + 8)
  doc.text(employee.contract_type || '—', margin + 28, y + 16)
  doc.setFont('helvetica', 'bold')
  doc.text('Period:', 120, y + 8)
  doc.text('Daily Rate:', 120, y + 16)
  doc.setFont('helvetica', 'normal')
  doc.text(month, 140, y + 8)
  doc.text(`¥${(salaryData?.dailyRate||0).toLocaleString()}`, 140, y + 16)
  y += 32

  // Earnings
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(6, 13, 24)
  doc.text('Earnings', margin, y)
  y += 4
  doc.setFillColor(6, 13, 24)
  doc.rect(margin, y, W - margin*2, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(9)
  doc.text('Description', margin + 4, y + 5)
  doc.text('Amount', W - margin - 4, y + 5, { align:'right' })
  y += 9

  const earnings = [
    ['Base Salary', `¥${(salaryData?.base||0).toLocaleString()}`],
    ['Spot Jobs Bonus', `¥${(salaryData?.spotEarned||0).toLocaleString()}`],
    ['Days Worked', `${salaryData?.workedDays||0} days`],
    ['Hours', `${salaryData?.hours||0}h`],
  ]

  earnings.forEach(([l,v], i) => {
    if (i%2===0) { doc.setFillColor(248,250,255); doc.rect(margin,y-1,W-margin*2,8,'F') }
    doc.setTextColor(50,50,50)
    doc.setFont('helvetica','normal')
    doc.setFontSize(9)
    doc.text(l, margin+4, y+5)
    doc.setFont('helvetica','bold')
    doc.text(v, W-margin-4, y+5, {align:'right'})
    y += 8
  })

  // Total earnings
  doc.setFillColor(193,156,86)
  doc.rect(margin, y, W-margin*2, 8, 'F')
  doc.setTextColor(255,255,255)
  doc.setFont('helvetica','bold')
  doc.setFontSize(10)
  doc.text('TOTAL EARNINGS', margin+4, y+5.5)
  doc.text(`¥${(salaryData?.total||0).toLocaleString()}`, W-margin-4, y+5.5, {align:'right'})
  y += 14

  // Deductions
  const deductions = payments.filter(p=>p.is_deduction)

  const todayPdf = new Date().toISOString().split('T')[0]
  const receivedAdvances = advances.filter(a => {
    const jun = a.description?.match(/Jun (\d+)/); if (jun) return '2026-06-'+jun[1].padStart(2,'0') < todayPdf
    const jul = a.description?.match(/Jul (\d+)/); if (jul) return '2026-07-'+jul[1].padStart(2,'0') < todayPdf
    return false
  })
  const advancesTotal = receivedAdvances.reduce((s,a)=>s+Number(a.amount),0)
  if (deductions.length > 0 || advancesTotal > 0) {
    doc.setFont('helvetica','bold')
    doc.setFontSize(11)
    doc.setTextColor(6,13,24)
    doc.text('Deductions', margin, y)
    y += 4
    doc.setFillColor(180,30,30)
    doc.rect(margin, y, W-margin*2, 7, 'F')
    doc.setTextColor(255,255,255)
    doc.setFontSize(9)
    doc.text('Description', margin+4, y+5)
    doc.text('Amount', W-margin-4, y+5, {align:'right'})
    y += 9

    if (advancesTotal > 0) {
      doc.setFillColor(255,245,245)
      doc.rect(margin,y-1,W-margin*2,8,'F')
      doc.setTextColor(50,50,50)
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      doc.text('Salary Advances', margin+4, y+5)
      doc.setFont('helvetica','bold')
      doc.setTextColor(180,30,30)
      doc.text(`-¥${advancesTotal.toLocaleString()}`, W-margin-4, y+5, {align:'right'})
      y += 8
    }

    deductions.forEach((d,i) => {
      if (i%2!==0) { doc.setFillColor(255,245,245); doc.rect(margin,y-1,W-margin*2,8,'F') }
      doc.setTextColor(50,50,50)
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      doc.text(d.description.substring(0,50), margin+4, y+5)
      doc.setFont('helvetica','bold')
      doc.setTextColor(180,30,30)
      doc.text(`-¥${Number(d.amount).toLocaleString()}`, W-margin-4, y+5, {align:'right'})
      y += 8
    })

    const totalDeductions = advancesTotal + deductions.reduce((s,d)=>s+Number(d.amount),0)
    doc.setFillColor(180,30,30)
    doc.rect(margin, y, W-margin*2, 8, 'F')
    doc.setTextColor(255,255,255)
    doc.setFont('helvetica','bold')
    doc.setFontSize(10)
    doc.text('TOTAL DEDUCTIONS', margin+4, y+5.5)
    doc.text(`-¥${totalDeductions.toLocaleString()}`, W-margin-4, y+5.5, {align:'right'})
    y += 14
  }

  // Net pay
  // Net pay = only actual salary payments (not advances)
  const netPay = payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance'&&p.payment_type!=='deduction').reduce((s,p)=>s+Number(p.amount),0)
  doc.setFillColor(6,13,24)
  doc.rect(margin, y, W-margin*2, 14, 'F')
  doc.setTextColor(193,156,86)
  doc.setFont('helvetica','bold')
  doc.setFontSize(14)
  doc.text('NET PAYMENT', margin+4, y+9)
  doc.text(`¥${netPay.toLocaleString()}`, W-margin-4, y+9, {align:'right'})
  y += 20

  // Payment schedule
  if (payments.filter(p=>!p.is_deduction).length > 0) {
    doc.setFont('helvetica','bold')
    doc.setFontSize(10)
    doc.setTextColor(6,13,24)
    doc.text('Payment Schedule', margin, y)
    y += 6
    payments.filter(p=>!p.is_deduction).forEach(p => {
      doc.setFont('helvetica','normal')
      doc.setFontSize(9)
      doc.setTextColor(50,50,50)
      doc.text(`${p.payment_date}  —  ${p.description||'Payment'}`, margin+4, y)
      doc.setFont('helvetica','bold')
      doc.setTextColor(p.payment_type==='advance'?180:15, p.payment_type==='advance'?30:110, p.payment_type==='advance'?30:86)
      doc.text(`¥${Number(p.amount).toLocaleString()}`, W-margin-4, y, {align:'right'})
      doc.setTextColor(120,120,120)
      doc.setFont('helvetica','normal')
      doc.text(p.status.toUpperCase(), margin+4, y+5)
      y += 6
    })
  }

  // Footer
  doc.setFillColor(6,13,24)
  doc.rect(0, 285, W, 12, 'F')
  doc.setTextColor(193,156,86)
  doc.setFontSize(7)
  doc.text('KuriPuro by JBM — Confidential Payslip', margin, 292)
  doc.text(`Generated: ${new Date().toLocaleString('ja-JP')}`, W-margin, 292, {align:'right'})

  return doc
}

export async function generatePayslipJP(employee, month, salaryData, payments, advances) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
  const W = 210, margin = 14
  let y = margin

  const monthDate = new Date(month + '-01')
  const monthJP = `${monthDate.getFullYear()}年${monthDate.getMonth()+1}月`

  // Header
  doc.setFillColor(6, 13, 24)
  doc.rect(0, 0, W, 35, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('KuriPuro by JBM', margin, 14)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('月次給与明細書', margin, 23)
  doc.text(monthJP, W - margin, 23, { align:'right' })
  y = 44

  // Employee info box
  doc.setFillColor(245, 247, 255)
  doc.roundedRect(margin, y, W - margin*2, 28, 2, 2, 'F')
  doc.setTextColor(50, 50, 50)
  doc.setFontSize(9)

  const rows = [
    ['従業員', employee.full_name||'—', '契約種別', employee.contract_type||'—'],
    ['対象期間', monthJP, '日給', `¥${(salaryData?.dailyRate||0).toLocaleString()}`],
    ['勤務日数', `${salaryData?.workedDays||0} days`, '勤務時間', `${salaryData?.hours||0}h`],
  ]
  rows.forEach((row, i) => {
    doc.setFont('helvetica', 'bold')
    doc.text(row[0]+':', margin+4, y+8+(i*8))
    doc.setFont('helvetica', 'normal')
    doc.text(row[1], margin+50, y+8+(i*8))
    doc.setFont('helvetica', 'bold')
    doc.text(row[2]+':', 120, y+8+(i*8))
    doc.setFont('helvetica', 'normal')
    doc.text(row[3], 160, y+8+(i*8))
  })
  y += 34

  // Earnings section
  const sectionHeader = (title, r, g, b) => {
    doc.setFillColor(r, g, b)
    doc.rect(margin, y, W-margin*2, 7, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(title, margin+4, y+5)
    doc.text('金額', W-margin-4, y+5, {align:'right'})
    y += 9
  }

  const tableRow = (label, value, idx, color) => {
    if (idx%2===0) { doc.setFillColor(248,250,255); doc.rect(margin,y-1,W-margin*2,8,'F') }
    doc.setTextColor(50,50,50)
    doc.setFont('helvetica','normal')
    doc.setFontSize(9)
    doc.text(label, margin+4, y+5)
    doc.setFont('helvetica','bold')
    if (color) doc.setTextColor(...color)
    else doc.setTextColor(50,50,50)
    doc.text(value, W-margin-4, y+5, {align:'right'})
    y += 8
  }

  doc.setFont('helvetica','bold')
  doc.setFontSize(11)
  doc.setTextColor(6,13,24)
  doc.text('支払項目', margin, y)
  y += 5
  sectionHeader('項目', 6, 13, 24)
  tableRow('基本給', `¥${(salaryData?.base||0).toLocaleString()}`, 0)
  tableRow('スポット手当', `¥${(salaryData?.spotEarned||0).toLocaleString()}`, 1)

  doc.setFillColor(193,156,86)
  doc.rect(margin, y, W-margin*2, 8, 'F')
  doc.setTextColor(255,255,255)
  doc.setFont('helvetica','bold')
  doc.setFontSize(10)
  doc.text('支給合計', margin+4, y+5.5)
  doc.text(`¥${(salaryData?.total||0).toLocaleString()}`, W-margin-4, y+5.5, {align:'right'})
  y += 14

  // Deductions
  const todayPdf = new Date().toISOString().split('T')[0]
  const receivedAdv = advances.filter(a => {
    const jun = a.description?.match(/Jun (\d+)/); if (jun) return '2026-06-'+jun[1].padStart(2,'0') < todayPdf
    const jul = a.description?.match(/Jul (\d+)/); if (jul) return '2026-07-'+jul[1].padStart(2,'0') < todayPdf
    return false
  })
  const advTotal = receivedAdv.reduce((s,a)=>s+Number(a.amount),0)
  const deds = payments.filter(p=>p.is_deduction)

  if (deds.length>0 || advTotal>0) {
    doc.setFont('helvetica','bold')
    doc.setFontSize(11)
    doc.setTextColor(6,13,24)
    doc.text('控除項目', margin, y)
    y += 5
    sectionHeader('項目', 180, 30, 30)
    if (advTotal>0) tableRow('給与前払い', `-¥${advTotal.toLocaleString()}`, 0, [180,30,30])
    deds.forEach((d,i)=>tableRow(d.description.substring(0,45), `-¥${Number(d.amount).toLocaleString()}`, i+1, [180,30,30]))
    const totalDeds = advTotal + deds.reduce((s,d)=>s+Number(d.amount),0)
    doc.setFillColor(180,30,30)
    doc.rect(margin, y, W-margin*2, 8, 'F')
    doc.setTextColor(255,255,255)
    doc.setFont('helvetica','bold')
    doc.setFontSize(10)
    doc.text('控除合計', margin+4, y+5.5)
    doc.text(`-¥${totalDeds.toLocaleString()}`, W-margin-4, y+5.5, {align:'right'})
    y += 14
  }

  // Net
  const netPay = payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance'&&p.payment_type!=='deduction').reduce((s,p)=>s+Number(p.amount),0)
  doc.setFillColor(6,13,24)
  doc.rect(margin, y, W-margin*2, 14, 'F')
  doc.setTextColor(193,156,86)
  doc.setFont('helvetica','bold')
  doc.setFontSize(13)
  doc.text('差引支給額', margin+4, y+9)
  doc.text(`¥${netPay.toLocaleString()}`, W-margin-4, y+9, {align:'right'})
  y += 20

  // Payment schedule
  const upcoming = payments.filter(p=>!p.is_deduction)
  if (upcoming.length>0) {
    doc.setFont('helvetica','bold')
    doc.setFontSize(10)
    doc.setTextColor(6,13,24)
    doc.text('支払予定', margin, y)
    y += 6
    doc.setFillColor(240,245,255)
    doc.rect(margin, y, W-margin*2, 7, 'F')
    doc.setTextColor(50,50,50)
    doc.setFontSize(8)
    doc.setFont('helvetica','bold')
    doc.text('Date / Highi', margin+4, y+5)
    doc.text('Description / Naiyou', margin+35, y+5)
    doc.text('Amount', W-margin-30, y+5)
    doc.text('Status', W-margin-4, y+5, {align:'right'})
    y += 9
    upcoming.forEach((p,i) => {
      if (i%2===0) { doc.setFillColor(248,250,255); doc.rect(margin,y-1,W-margin*2,8,'F') }
      doc.setFont('helvetica','normal')
      doc.setFontSize(8)
      doc.setTextColor(50,50,50)
      doc.text(p.payment_date, margin+4, y+5)
      doc.text((p.description||'Payment').substring(0,35), margin+35, y+5)
      doc.setFont('helvetica','bold')
      doc.setTextColor(p.payment_type==='advance'?180:15, p.payment_type==='advance'?30:110, p.payment_type==='advance'?30:86)
      doc.text(`¥${Number(p.amount).toLocaleString()}`, W-margin-30, y+5)
      doc.setTextColor(120,120,120)
      doc.setFont('helvetica','normal')
      doc.text(p.status.toUpperCase(), W-margin-4, y+5, {align:'right'})
      y += 8
    })
  }

  // Footer
  doc.setFillColor(6,13,24)
  doc.rect(0, 285, W, 12, 'F')
  doc.setTextColor(193,156,86)
  doc.setFontSize(7)
  doc.text('KuriPuro by JBM — 社外秘', margin, 292)
  doc.text(`Sakusei: ${new Date().toLocaleString('ja-JP')}`, W-margin, 292, {align:'right'})

  return doc
}
