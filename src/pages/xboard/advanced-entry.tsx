import { Suspense, lazy } from 'react'

import { isTauriRuntime } from '@/utils/tauri'

import XboardAdvancedPage from './advanced'

const LegacySettingsPage = lazy(() => import('../settings'))

const AdvancedSettingsEntry = () =>
  isTauriRuntime() ? (
    <Suspense fallback={null}>
      <LegacySettingsPage />
    </Suspense>
  ) : (
    <XboardAdvancedPage />
  )

export default AdvancedSettingsEntry
