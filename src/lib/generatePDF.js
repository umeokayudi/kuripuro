import { jsPDF } from 'jspdf'
import { viewablePhotoUrl } from './photoUrl'
import { signatureForDisplay } from './signature'
import { formatDistance } from './geocode.js'

// Carrega uma imagem de URL como dataURL pra embutir no PDF
async function loadImageDataUrl(url) {
  if (!url) return null
  try {
    const resp = await fetch(viewablePhotoUrl(url))
    if (!resp.ok) return null
    const blob = await resp.blob()
    return await new Promise((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(r.result)
      r.onerror = rej
      r.readAsDataURL(blob)
    })
  } catch { return null }
}


const tokyoTime = (iso) => iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' }) : '—'
const fmtCoord = (lat, lng) => (lat != null && lng != null) ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : 'no GPS'

// Daily report: every job of the day, each one with check-in/out time + GPS and its signature.
export async function generateDailyReport(date, jobs, employeeName, opts = {}) {
  const showEmployee = !!opts.showEmployee
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
  doc.text(new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }), W - margin, 20, { align:'right' })
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
    const checkin = tokyoTime(j.started_at)
    const checkout = tokyoTime(j.completed_at)
    const dur = j.started_at && j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 60000) + 'm' : '—'
    const isEven = idx % 2 === 0
    if (isEven) { doc.setFillColor(248, 250, 255); doc.rect(margin, y - 1, W - margin*2, 8, 'F') }
    doc.setTextColor(50, 50, 50)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(String(idx + 1), margin + 2, y + 5)
    const place = (j.title || '').replace(/ — .*/,'')
    const name = showEmployee ? `${place.substring(0, 24)} · ${(j.employee_name || '—').split(' ')[0]}` : place.substring(0, 38)
    doc.text(name, margin + 8, y + 5)
    doc.text(checkin, margin + 90, y + 5)
    doc.text(checkout, margin + 115, y + 5)
    doc.text(dur, margin + 142, y + 5)
    if (j.status === 'completed') { doc.setTextColor(15, 110, 86); doc.setFont('helvetica', 'bold') }
    else { doc.setTextColor(200, 50, 50) }
    doc.text((j.status === 'in_progress' ? 'IN PROGRESS' : j.status === 'assigned' ? 'NOT DONE' : j.status).toUpperCase(), margin + 164, y + 5)
    y += 8
  })

  // Check-in / check-out (GPS) and signature for EVERY job
  y += 6
  if (y > 250) { doc.addPage(); y = margin }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(6, 13, 24)
  doc.text('Check-in / Check-out (GPS) and signature', margin, y)
  y += 5
  for (const [idx, j] of jobs.entries()) {
    const blockH = 30
    if (y + blockH > 280) { doc.addPage(); y = margin }
    doc.setDrawColor(220, 226, 236)
    doc.roundedRect(margin, y, W - margin*2, blockH, 2, 2, 'S')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30, 40, 60)
    const place = (j.title || '').replace(/ — .*/,'')
    doc.text(`${idx + 1}. ${place}`.substring(0, 60), margin + 3, y + 6)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90)
    const who = [j.employee_name, j.area ? `Area: ${j.area}` : null].filter(Boolean).join(' · ')
    if (who) doc.text(who.substring(0, 70), margin + 3, y + 11)
    const inLine = `In  ${tokyoTime(j.started_at)}  ${fmtCoord(j.start_lat, j.start_lng)}${j.gps_start_distance != null ? `  (${formatDistance(j.gps_start_distance)} from site)` : ''}`
    const outLine = `Out ${tokyoTime(j.completed_at)}  ${fmtCoord(j.end_lat, j.end_lng)}${j.gps_end_distance != null ? `  (${formatDistance(j.gps_end_distance)} from site)` : ''}`
    doc.text(inLine, margin + 3, y + 17)
    doc.text(outLine, margin + 3, y + 22)
    if (j.retro_report != null) doc.text('Retroactive report (sent after the service)', margin + 3, y + 27)
    // signature box on the right
    const boxW = 56, boxH = 24, bx = W - margin - boxW - 3, by = y + 3
    doc.setDrawColor(200, 200, 200)
    doc.rect(bx, by, boxW, boxH)
    const sig = j.signature_url ? await signatureForDisplay(j.signature_url) : null
    if (sig) {
      try { doc.addImage(sig, 'PNG', bx + 1, by + 1, boxW - 2, boxH - 2) } catch {}
    } else {
      doc.setTextColor(200, 50, 50); doc.setFontSize(7)
      doc.text(j.status === 'completed' ? 'Not signed' : '—', bx + boxW / 2, by + boxH / 2 + 1, { align: 'center' })
    }
    y += blockH + 3
  }

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
        if (data) {
          try {
            const fmt = data.includes('image/png') ? 'PNG' : 'JPEG'
            doc.addImage(data, fmt, x, y, imgW, imgH)
            doc.setFontSize(7); doc.setTextColor(120,120,120)
            doc.text(label, x, y + imgH + 4)
          } catch {}
        }
        x += imgW + gap
      }
      y += imgH + 10
    }
  }

  // Signature area: each employee's own signature (taken from the jobs they signed
  // at check-out) and the admin's saved signature, side by side.
  const signers = new Map()
  for (const j of jobs) {
    const name = showEmployee ? (j.employee_name || employeeName) : employeeName
    if (!name) continue
    const prev = signers.get(name)
    const at = j.completed_at || j.started_at || ''
    if (!prev || (j.signature_url && (!prev.url || at >= prev.at))) signers.set(name, { url: j.signature_url || prev?.url || null, at })
  }
  const slots = [...signers].map(([name, s]) => ({ label: 'Employee Signature', name, url: s.url }))
  slots.push({ label: 'Admin Signature', name: opts.adminName || '', url: opts.adminSignature || null })
  const perRow = 3, slotGap = 8, slotW = (W - margin * 2 - slotGap * (perRow - 1)) / perRow
  const sigH = 20, rowH = sigH + 14
  const rows = Math.ceil(slots.length / perRow)
  y = Math.max(y + 10, 280 - rows * rowH)
  if (y + rows * rowH > 282) { doc.addPage(); y = margin + 10 }
  for (const [i, slot] of slots.entries()) {
    const col = slot.label === 'Admin Signature' && slots.length <= perRow ? perRow - 1 : i % perRow
    const row = slot.label === 'Admin Signature' && slots.length <= perRow ? 0 : Math.floor(i / perRow)
    const sx = margin + col * (slotW + slotGap), sy = y + row * rowH
    const img = slot.url ? await signatureForDisplay(slot.url) : null
    if (img) {
      try { doc.addImage(img, 'PNG', sx + 4, sy, Math.min(slotW - 8, sigH * 2.4), sigH) } catch {}
    }
    doc.setDrawColor(180, 180, 180)
    doc.line(sx, sy + sigH + 1, sx + slotW, sy + sigH + 1)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120)
    doc.text(slot.label, sx, sy + sigH + 5)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(40, 40, 40)
    if (slot.name) doc.text(String(slot.name).substring(0, 40), sx, sy + sigH + 10)
    if (!img) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(200, 50, 50)
      doc.text('Not signed', sx + slotW / 2, sy + sigH - 4, { align: 'center' })
    }
  }

  // Footer
  doc.setFillColor(6, 13, 24)
  doc.rect(0, 285, W, 12, 'F')
  doc.setTextColor(193, 156, 86)
  doc.setFontSize(7)
  doc.text('KuriPuro by JBM — Confidential', margin, 292)
  doc.text(`Generated: ${new Date().toLocaleString('ja-JP')}`, W - margin, 292, { align:'right' })

  return doc
}
