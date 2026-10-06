/** Open 見積書 / 請求書 HTML at phone width. about:blank + document.write is shrunk by Chrome. */

export function isCompactPrintView() {
  if (typeof window === 'undefined') return false
  if (document.querySelector('.app-shell-mobile')) return true
  return window.matchMedia?.('(max-width: 900px)')?.matches === true
}

function closeOverlay() {
  document.getElementById('kp-print-overlay')?.remove()
}

export function showPrintOverlay(html, { autoPrint = false } = {}) {
  closeOverlay()
  const ja = /lang="ja"/i.test(html)
  const wrap = document.createElement('div')
  wrap.id = 'kp-print-overlay'
  wrap.className = 'kp-print-overlay'
  wrap.innerHTML = `<div class="kp-print-overlay-bar">
      <button type="button" class="btn btn-sm" data-kp-print-close>${ja ? '閉じる' : 'Close'}</button>
      <button type="button" class="btn btn-sm btn-primary" data-kp-print-go>${ja ? '印刷' : 'Print'}</button>
    </div>
    <iframe title="${ja ? '見積書' : 'Document'}" class="kp-print-frame"></iframe>`
  document.body.appendChild(wrap)
  const iframe = wrap.querySelector('iframe')
  iframe.srcdoc = html
  wrap.querySelector('[data-kp-print-close]').onclick = closeOverlay
  wrap.querySelector('[data-kp-print-go]').onclick = () => iframe.contentWindow?.print()
  if (autoPrint) {
    iframe.addEventListener('load', () => iframe.contentWindow?.print(), { once: true })
  }
  return { ok: true, mode: 'overlay' }
}

export function openPrintBlob(html, { autoPrint = false } = {}) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (!w) {
    URL.revokeObjectURL(url)
    return showPrintOverlay(html, { autoPrint })
  }
  if (autoPrint) {
    const printWhenReady = () => { try { w.focus(); w.print() } catch {} }
    w.addEventListener?.('load', printWhenReady)
    setTimeout(printWhenReady, 600)
  }
  setTimeout(() => URL.revokeObjectURL(url), 120000)
  return { ok: true, mode: 'blob' }
}

export function openPrintHtml(html, opts = {}) {
  if (!html) return { ok: false }
  if (isCompactPrintView()) return showPrintOverlay(html, opts)
  return openPrintBlob(html, opts)
}
