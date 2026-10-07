import { useEffect, useState } from 'react'
import { isAdminMobileLayout, readAdminViewPref, writeAdminViewPref } from '../lib/adminLayout'

export function useAdminLayout() {
  const [pref, setPref] = useState(readAdminViewPref)
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))

  useEffect(() => {
    const read = () => setWidth(window.visualViewport?.width || window.innerWidth)
    read()
    window.addEventListener('resize', read)
    window.visualViewport?.addEventListener('resize', read)
    return () => {
      window.removeEventListener('resize', read)
      window.visualViewport?.removeEventListener('resize', read)
    }
  }, [])

  const mobile = isAdminMobileLayout(width, pref)
  const setView = (value) => {
    writeAdminViewPref(value)
    setPref(value)
  }

  return { mobile, pref, setView, width }
}
