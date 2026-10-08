/** Show printable Mitsumori HTML in a full-window preview, without opening a stray tab. */

let priorBodyOverflow = ''
let previouslyFocused = null
let onEscape = null

function closeOverlay() {
  const overlay = document.getElementById('kp-print-overlay')
  if (!overlay) return
  overlay.remove()
  document.body.style.overflow = priorBodyOverflow
  if (onEscape) window.removeEventListener('keydown', onEscape)
  onEscape = null
  previouslyFocused?.focus?.()
  previouslyFocused = null
}

export function showPrintOverlay(html, { autoPrint = false } = {}) {
  closeOverlay()
  const ja = /lang="ja"/i.test(html)
  const wrap = document.createElement('div')
  wrap.id = 'kp-print-overlay'
  wrap.className = 'kp-print-overlay'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.setAttribute('aria-label', ja ? '見積書プレビュー' : 'Quote preview')
  wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;overflow:hidden;background:#e9edf3;padding:0;margin:0;'
  wrap.innerHTML = `<div class="kp-print-overlay-bar" style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex:0 0 auto;padding:calc(10px + env(safe-area-inset-top,0px)) max(14px,env(safe-area-inset-right,0px)) 10px max(14px,env(safe-area-inset-left,0px));background:#fff;border-bottom:1px solid #dce2ea;box-shadow:0 2px 8px rgba(18,32,55,.08)">
      <button type="button" class="btn btn-sm" data-kp-print-close>${ja ? '閉じる' : 'Close'}</button>
      <button type="button" class="btn btn-sm btn-primary" data-kp-print-go>${ja ? '印刷' : 'Print'}</button>
    </div>
    <iframe title="${ja ? '見積書' : 'Document'}" class="kp-print-frame"></iframe>`
  previouslyFocused = document.activeElement
  priorBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.body.appendChild(wrap)
  const iframe = wrap.querySelector('iframe')
  iframe.style.cssText = 'display:block;flex:1 1 auto;width:min(900px,calc(100% - 32px));height:100%;min-height:0;margin:16px auto;border:0;border-radius:8px;background:#fff;box-shadow:0 8px 30px rgba(18,32,55,.16)'
  iframe.srcdoc = html
  wrap.querySelector('[data-kp-print-close]').onclick = closeOverlay
  wrap.querySelector('[data-kp-print-go]').onclick = () => iframe.contentWindow?.print()
  onEscape = event => { if (event.key === 'Escape') closeOverlay() }
  window.addEventListener('keydown', onEscape)
  wrap.querySelector('[data-kp-print-close]').focus()
  if (autoPrint) {
    iframe.addEventListener('load', () => iframe.contentWindow?.print(), { once: true })
  }
  return { ok: true, mode: 'overlay' }
}

export function openPrintHtml(html, opts = {}) {
  if (!html) return { ok: false }
  return showPrintOverlay(html, opts)
}
