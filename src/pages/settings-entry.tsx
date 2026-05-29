import { Suspense, lazy } from 'react'

import { isTauriRuntime } from '@/utils/tauri'

import AdvancedSettingsPage from './xboard/advanced-entry'

const LegacySettingsPage = lazy(() => import('./settings'))

const SettingsEntryPage = () =>
  isTauriRuntime() ? (
    <Suspense fallback={null}>
      <LegacySettingsPage />
    </Suspense>
  ) : (
    <AdvancedSettingsPage />
  )

export default SettingsEntryPage
