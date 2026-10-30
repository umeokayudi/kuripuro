import { useEffect, useState } from 'react'
import { hideTests, setHideTests, HIDE_TESTS_CHANGED } from '../lib/testData'

/** [hide, setHide] — global "hide test data" switch shared by every screen (ON by default). */
export function useHideTests() {
  const [on, setOn] = useState(hideTests)
  useEffect(() => {
    const f = () => setOn(hideTests())
    window.addEventListener(HIDE_TESTS_CHANGED, f)
    return () => window.removeEventListener(HIDE_TESTS_CHANGED, f)
  }, [])
  return [on, setHideTests]
}
