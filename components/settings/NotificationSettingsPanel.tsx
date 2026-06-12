'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  ensurePushSubscription,
  getNotificationStatus,
  isPushConfigured,
  requestNotificationPermission,
  type NotificationStatus,
} from '@/lib/notifications'
import {
  deleteNotificationSubscription,
  getNotificationPreferences,
  saveNotificationSubscription,
  sendTestNotification,
  updateNotificationPreferences,
} from '@/app/(app)/notifications/actions'
import type { NotificationPreferences, NotificationPreferenceUpdate } from '@/lib/types'

type DeviceStatus = 'idle' | 'saving' | 'saved' | 'disabled' | 'unconfigured' | 'error'

function statusCopy(status: NotificationStatus | null) {
  if (!status) return 'Checking this device...'
  if (!status.supported) return 'Notifications are not supported in this browser.'
  if (status.requiresInstall) return 'Install SideBar to your home screen before enabling notifications.'
  if (status.permission === 'granted') return 'Notifications are enabled on this device.'
  if (status.permission === 'denied') return 'Notifications are blocked in browser settings.'
  if (!status.pushSupported) return 'This browser can ask for alerts, but push delivery is not available.'
  return 'Notifications are available on this device.'
}

export default function NotificationSettingsPanel() {
  const [status, setStatus] = useState<NotificationStatus | null>(null)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [preferencesUnavailable, setPreferencesUnavailable] = useState('')
  const [error, setError] = useState('')
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('idle')
  const [deviceRegistered, setDeviceRegistered] = useState<boolean | null>(null)
  const [isPending, startTransition] = useTransition()
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferenceUpdate | null>(null)
  const [testStatus, setTestStatus] = useState<string>('')
  const [testSending, setTestSending] = useState(false)

  useEffect(() => {
    setStatus(getNotificationStatus())
  }, [])

  // Detect an existing registration so the device button renders as the
  // truthful toggle state without a manual "check" step.
  useEffect(() => {
    if (status?.permission !== 'granted' || !status.pushSupported) return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    let ignore = false
    navigator.serviceWorker.getRegistration('/sw.js')
      .then(registration => registration?.pushManager.getSubscription())
      .then(subscription => {
        if (!ignore) setDeviceRegistered(Boolean(subscription))
      })
      .catch(() => {
        if (!ignore) setDeviceRegistered(null)
      })
    return () => { ignore = true }
  }, [status?.permission, status?.pushSupported])

  useEffect(() => {
    if (status?.permission !== 'granted') return

    let ignore = false
    getNotificationPreferences().then(result => {
      if (ignore) return
      if ('error' in result) {
        setError(result.error)
      } else if ('unavailable' in result) {
        setPreferencesUnavailable(result.message)
      } else {
        setPreferencesUnavailable('')
        setPreferences(result.preferences)
      }
    })

    return () => { ignore = true }
  }, [status?.permission])

  function handleEnable() {
    setError('')
    startTransition(async () => {
      try {
        await requestNotificationPermission()
        const nextStatus = getNotificationStatus()
        setStatus(nextStatus)
        if (nextStatus.permission === 'granted') {
          await syncPushSubscription()
        }
      } catch {
        setError('Could not update notification permission.')
      }
    })
  }

  async function syncPushSubscription() {
    setError('')

    if (!isPushConfigured()) {
      setDeviceStatus('unconfigured')
      return
    }

    setDeviceStatus('saving')
    const subscriptionResult = await ensurePushSubscription()
    if ('error' in subscriptionResult) {
      setDeviceStatus('error')
      setError(subscriptionResult.error)
      return
    }

    const saveResult = await saveNotificationSubscription(subscriptionResult.subscription)
    if ('error' in saveResult) {
      setDeviceStatus('error')
      setError(saveResult.error)
      return
    }

    setDeviceStatus('saved')
    setDeviceRegistered(true)
  }

  /**
   * Browser permission cannot be revoked from page script, but the device's
   * push registration can: drop the browser subscription and delete the
   * stored endpoint so this device stops receiving pushes.
   */
  async function disableOnThisDevice() {
    setError('')
    setDeviceStatus('saving')
    try {
      const registration = await navigator.serviceWorker?.getRegistration('/sw.js')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        const result = await deleteNotificationSubscription(endpoint)
        if ('error' in result) {
          setDeviceStatus('error')
          setError(result.error)
          return
        }
      }
      setDeviceRegistered(false)
      setDeviceStatus('disabled')
    } catch {
      setDeviceStatus('error')
      setError('Could not disable push on this device.')
    }
  }

  async function handleSendTest() {
    setError('')
    setTestStatus('')
    setTestSending(true)
    try {
      const result = await sendTestNotification()
      if ('error' in result) {
        setTestStatus(result.error)
      } else if (result.delivered) {
        setTestStatus('Test push handed to your push service — it should appear on this device any second. (Close or background the app if nothing shows; some platforms suppress notifications for the focused tab.)')
      } else if (result.reason === 'no_subscriptions') {
        setTestStatus('No registered device found — use "Register this device" first, then try again.')
      } else if (result.reason === 'not_configured') {
        setTestStatus('Push delivery is not configured on this deployment (missing VAPID keys).')
      } else {
        setTestStatus(`Push delivery failed: ${result.reason ?? 'unknown error'}.`)
      }
    } catch {
      setTestStatus('Could not send a test notification.')
    }
    setTestSending(false)
  }

  async function handlePreferenceChange(key: keyof NotificationPreferenceUpdate, value: boolean) {
    setError('')
    setSavingKey(key)
    const result = await updateNotificationPreferences({ [key]: value })
    if ('error' in result) {
      setError(result.error)
    } else if ('unavailable' in result) {
      setPreferencesUnavailable(result.message)
    } else {
      setPreferencesUnavailable('')
      setPreferences(result.preferences)
    }
    setSavingKey(null)
  }

  return (
    <section
      aria-labelledby="notification-settings-heading"
      className="rounded-xl border border-white/10 p-4 space-y-3"
      style={{ background: 'var(--bg-primary)' }}
    >
      <div>
        <h2 id="notification-settings-heading" className="text-sm font-semibold text-[var(--text-primary)]">
          Notifications
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]" data-testid="notification-status">
          {statusCopy(status)}
        </p>
      </div>

      {status?.permission === 'granted' && preferences && (
        <fieldset className="space-y-2" aria-label="Notification delivery preferences">
          <PreferenceToggle
            label="Direct messages"
            description="Notify me when someone sends me a DM."
            checked={preferences.dm_messages}
            disabled={savingKey !== null}
            onChange={checked => handlePreferenceChange('dm_messages', checked)}
          />
          <PreferenceToggle
            label="Mentions"
            description="Notify me when someone mentions me."
            checked={preferences.mentions}
            disabled={savingKey !== null}
            onChange={checked => handlePreferenceChange('mentions', checked)}
          />
          <PreferenceToggle
            label="Group messages"
            description="Notify me about all visible group channel messages."
            checked={preferences.group_messages}
            disabled={savingKey !== null}
            onChange={checked => handlePreferenceChange('group_messages', checked)}
          />
        </fieldset>
      )}

      {status?.permission === 'granted' && preferencesUnavailable && (
        <p className="text-xs text-[var(--text-muted)]" data-testid="notification-preferences-unavailable">
          {preferencesUnavailable}
        </p>
      )}

      {status?.permission === 'granted' && !preferences && !preferencesUnavailable && (
        <p className="text-xs text-[var(--text-muted)]" data-testid="notification-preferences-loading">
          Loading notification delivery settings...
        </p>
      )}

      {status?.permission === 'granted' && status.pushSupported && (
        <div className="rounded-lg border border-white/10 p-3 space-y-2">
          <p className="text-xs text-[var(--text-muted)]" data-testid="notification-subscription-status">
            {deviceStatus === 'saving' && 'Updating this device...'}
            {deviceStatus === 'unconfigured' && 'Push subscription is not configured for this deployment.'}
            {deviceStatus === 'disabled' && 'Push is off on this device. Re-register any time.'}
            {deviceStatus !== 'saving' && deviceStatus !== 'unconfigured' && deviceStatus !== 'disabled' && (
              deviceRegistered
                ? 'This device is registered for push notifications.'
                : 'Register this device to receive push notifications when the app is closed.'
            )}
          </p>
          {isPushConfigured() && (
            <div className="flex flex-wrap gap-2">
              {deviceRegistered ? (
                <button
                  type="button"
                  data-testid="disable-device-push"
                  onClick={disableOnThisDevice}
                  disabled={deviceStatus === 'saving'}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  {deviceStatus === 'saving' ? 'Disabling...' : 'Disable on this device'}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="register-device-push"
                  onClick={syncPushSubscription}
                  disabled={deviceStatus === 'saving'}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-[var(--text-primary)] hover:bg-white/5 disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  {deviceStatus === 'saving' ? 'Registering...' : 'Register this device'}
                </button>
              )}
              <button
                type="button"
                data-testid="send-test-notification"
                onClick={handleSendTest}
                disabled={testSending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-[var(--text-primary)] hover:bg-white/5 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                {testSending ? 'Sending...' : 'Send test notification'}
              </button>
            </div>
          )}
          {testStatus && (
            <p className="text-xs text-[var(--text-faint)]" data-testid="test-notification-status">
              {testStatus}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      {/* Permission request only makes sense before it's granted — once
          granted it can't be revoked from page script, so the device
          toggle above is the on/off control. */}
      {status?.permission !== 'granted' && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={!status?.canRequest || isPending}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-40 disabled:cursor-default transition-colors"
        >
          {isPending ? 'Enabling...' : 'Enable notifications'}
        </button>
      )}
    </section>
  )
}

function PreferenceToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-white/10 p-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.currentTarget.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
        <span className="block text-xs text-[var(--text-muted)]">{description}</span>
      </span>
    </label>
  )
}
