import { useEffect, useState } from 'react'
import { isAdminMobileLayout, readAdminViewPref, writeAdminViewPref } from '../lib/adminLayout'

export function useAdminLayout() {
  const [pref, setPref] = useState(readAdminViewPref)
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const mobile = isAdminMobileLayout(width, pref)
  const setView = (value) => {
    writeAdminViewPref(value)
    setPref(value)
  }

  return { mobile, pref, setView, width }
}
