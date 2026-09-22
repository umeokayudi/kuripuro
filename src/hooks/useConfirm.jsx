import { createContext, useCallback, useContext, useRef, useState } from 'react'
import AppDialog from '../components/AppDialog'
import { isDialogRoleDark, normalizeConfirmOptions } from '../lib/appDialog'
import { useAuth } from './useAuth'
import { useLang } from './useLang'

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const { user } = useAuth()
  const { t } = useLang()
  const [state, setState] = useState(null)
  const resolverRef = useRef(null)
  const dark = isDialogRoleDark(user?.role)

  const confirm = useCallback((opts) => {
    const dlg = t?.dialog || {}
    const normalized = normalizeConfirmOptions(opts, {
      title: dlg.confirmTitle || '',
      confirm: dlg.ok || 'OK',
      cancel: dlg.cancel || 'Cancel',
    })
    return new Promise((resolve) => {
      if (resolverRef.current) resolverRef.current(false)
      resolverRef.current = resolve
      setState({
        ...normalized,
        dark: normalized.dark ?? dark,
      })
    })
  }, [t, dark])

  const finish = (ok) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setState(null)
    resolve?.(ok)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <AppDialog
          open
          title={state.title}
          message={state.message}
          confirmLabel={state.confirmLabel}
          cancelLabel={state.cancelLabel}
          tone={state.tone}
          dark={state.dark}
          hideCancel={state.hideCancel}
          wide={state.wide}
          onConfirm={() => finish(true)}
          onCancel={() => finish(false)}
        />
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm must be used inside ConfirmProvider')
  }
  return ctx
}

export { normalizeConfirmOptions, isDialogRoleDark }
