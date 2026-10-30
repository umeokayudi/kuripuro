// v1.0.117 · one "done — Undo" toast for destructive actions that can be reversed.
import toast from 'react-hot-toast'
import { pickLang } from '../hooks/useLang'

/** Shows `message` with an Undo button for 8 s; `undo` runs the reverse change. */
export function undoToast(message, undo, lang, onDone) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  toast(t => (
    <span className="undo-toast">
      {message}
      <button type="button" onClick={async () => {
        toast.dismiss(t.id)
        try {
          const res = await undo()
          if (res?.error) throw res.error
          toast.success(L('Undone', '元に戻しました', 'Desfeito'))
          onDone?.()
        } catch (e) { toast.error((e?.message || String(e)).slice(0, 200)) }
      }}>{L('Undo', '元に戻す', 'Desfazer')}</button>
    </span>
  ), { duration: 8000 })
}
