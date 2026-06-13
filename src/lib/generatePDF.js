import { jsPDF } from 'jspdf'

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
