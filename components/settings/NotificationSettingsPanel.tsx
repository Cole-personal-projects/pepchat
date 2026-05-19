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
  getNotificationPreferences,
  saveNotificationSubscription,
  updateNotificationPreferences,
} from '@/app/(app)/notifications/actions'
import type { NotificationPreferences, NotificationPreferenceUpdate } from '@/lib/types'

type DeviceStatus = 'idle' | 'saving' | 'saved' | 'unconfigured' | 'error'
type DeliveryCheckStatus = 'idle' | 'checking' | 'ok' | 'missing' | 'error'

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
  const [deliveryCheck, setDeliveryCheck] = useState<DeliveryCheckStatus>('idle')
  const [isPending, startTransition] = useTransition()
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferenceUpdate | null>(null)

  useEffect(() => {
    setStatus(getNotificationStatus())
  }, [])

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
    setDeliveryCheck('ok')
  }

  async function checkPushReliability() {
    setError('')
    setDeliveryCheck('checking')
    try {
      if (!status?.pushSupported || !isPushConfigured()) {
        setDeliveryCheck('missing')
        return
      }

      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      const subscription = await registration?.pushManager.getSubscription()
      setDeliveryCheck(subscription ? 'ok' : 'missing')
    } catch {
      setDeliveryCheck('error')
      setError('Could not check push registration on this device.')
    }
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
            {deviceStatus === 'saved' && 'This device is registered for push notifications.'}
            {deviceStatus === 'saving' && 'Registering this device...'}
            {deviceStatus === 'unconfigured' && 'Push subscription is not configured for this deployment.'}
            {(deviceStatus === 'idle' || deviceStatus === 'error') && 'Register this device to receive browser push notifications when delivery is available.'}
          </p>
          {isPushConfigured() && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={syncPushSubscription}
                disabled={deviceStatus === 'saving'}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-[var(--text-primary)] hover:bg-white/5 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                {deviceStatus === 'saving' ? 'Registering...' : 'Register this device'}
              </button>
              <button
                type="button"
                onClick={checkPushReliability}
                disabled={deliveryCheck === 'checking'}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/10 text-[var(--text-primary)] hover:bg-white/5 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                {deliveryCheck === 'checking' ? 'Checking...' : 'Check delivery setup'}
              </button>
            </div>
          )}
          {deliveryCheck !== 'idle' && (
            <p className="text-xs text-[var(--text-faint)]" data-testid="notification-delivery-check">
              {deliveryCheck === 'ok' && 'Push registration is present on this device.'}
              {deliveryCheck === 'missing' && 'No active push registration was found for this device.'}
              {deliveryCheck === 'error' && 'Delivery setup check failed.'}
              {deliveryCheck === 'checking' && 'Checking browser push registration...'}
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleEnable}
        disabled={!status?.canRequest || isPending}
        className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-40 disabled:cursor-default transition-colors"
      >
        {isPending ? 'Enabling...' : 'Enable notifications'}
      </button>
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
