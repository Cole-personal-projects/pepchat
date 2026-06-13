'use client'

import { useState, useRef, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import Avatar from '@/components/ui/Avatar'
import NotificationSettingsPanel from '@/components/settings/NotificationSettingsPanel'
import ReplayTipsButton from '@/components/onboarding/ReplayTipsButton'
import ColorPicker from './ColorPicker'
import BadgeSelector from './BadgeSelector'
import { updateProfile, removeAvatar } from '@/app/(app)/profile/actions'
import type { Profile, ProfileUpdate } from '@/lib/types'
import { PERMISSIONS, type Role } from '@/lib/permissions'

const AvatarCropModal = dynamic(() => import('./AvatarCropModal'), { ssr: false })

interface EditProfilePageProps {
  profile: Profile
  userRole: Role
}

function ProfilePreview({ draft }: { draft: Profile }) {
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden w-full md:w-[280px]" style={{ background: 'var(--bg-primary)' }}>
      <div style={{ background: draft.banner_color, height: 60 }} className="relative">
        <div className="absolute left-3" style={{ bottom: -28 }}>
          <Avatar user={draft} size={56}
            className="ring-4 ring-[var(--bg-primary)] rounded-full" />
        </div>
      </div>
      <div className="pt-10 px-3 pb-3 space-y-1">
        <p className="font-bold text-sm leading-tight" style={{ color: draft.username_color }}>
          {draft.display_name || draft.username}
        </p>
        {draft.display_name && <p className="text-xs text-[var(--text-muted)]">@{draft.username}</p>}
        {(draft.pronouns || draft.badge) && (
          <p className="text-xs text-[var(--text-muted)]">{[draft.pronouns, draft.badge].filter(Boolean).join(' · ')}</p>
        )}
        {draft.bio && <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap mt-1">{draft.bio}</p>}
        {draft.location && <p className="text-xs text-[var(--text-muted)]">📍 {draft.location}</p>}
        {draft.website && <p className="text-xs text-[var(--text-muted)]">🔗 {draft.website.replace(/^https?:\/\//, '')}</p>}
      </div>
    </div>
  )
}

export default function EditProfilePage({ profile, userRole }: EditProfilePageProps) {
  const [draft, setDraft] = useState<Profile>({ ...profile })
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [pendingAvatar, setPendingAvatar] = useState<{ dataUrl: string; ext: string } | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({})
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(profile) || pendingAvatar !== null
  const isAdmin = userRole === 'admin'
  const router = useRouter()

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft(prev => ({ ...prev, [key]: value }))
    setFieldErrors(prev => ({ ...prev, [key]: undefined }))
  }

  function validate(): boolean {
    const errors: Partial<Record<string, string>> = {}
    if (draft.display_name && draft.display_name.length > 32) errors.display_name = 'Max 32 characters'
    if (draft.bio && draft.bio.length > 190) errors.bio = 'Max 190 characters'
    if (draft.location && draft.location.length > 64) errors.location = 'Max 64 characters'
    if (draft.pronouns && draft.pronouns.length > 40) errors.pronouns = 'Max 40 characters'
    if (draft.website && !/^https?:\/\/.+/.test(draft.website)) errors.website = 'Please enter a valid URL starting with https://'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { setFieldErrors(prev => ({ ...prev, avatar: 'Avatar must be under 4MB' })); return }
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setFieldErrors(prev => ({ ...prev, avatar: 'Please use JPEG, PNG, WebP, or GIF' })); return
    }
    const reader = new FileReader()
    reader.onload = () => setCropSrc(reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  function handleCropApply(dataUrl: string, ext: string) {
    setCropSrc(null)
    setPendingAvatar({ dataUrl, ext })
    setDraft(prev => ({ ...prev, avatar_url: dataUrl }))
  }

  function handleSave() {
    if (!validate()) return
    startTransition(async () => {
      const update: ProfileUpdate = {
        display_name: draft.display_name || null,
        bio: draft.bio || null,
        location: draft.location || null,
        website: draft.website || null,
        username_color: draft.username_color,
        banner_color: draft.banner_color,
        badge: draft.badge,
        pronouns: draft.pronouns || null,
      }
      const avatarPayload = pendingAvatar
        ? { data: pendingAvatar.dataUrl, ext: pendingAvatar.ext }
        : undefined

      const result = await updateProfile(update, avatarPayload)
      if ('error' in result) {
        showToast(result.error, 'error')
      } else {
        setPendingAvatar(null)
        setDraft({ ...result.profile })
        showToast('Profile updated', 'success')
      }
    })
  }

  async function handleRemoveAvatar() {
    const result = await removeAvatar()
    if ('error' in result) { showToast(result.error, 'error'); return }
    setDraft(prev => ({ ...prev, avatar_url: null }))
    setPendingAvatar(null)
    showToast('Avatar removed', 'success')
  }

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ background: 'var(--bg-primary)', height: '100%' }}>
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-white/10">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Edit Profile</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-4xl mx-auto">

        <div className="flex flex-col gap-6 md:flex-row-reverse md:gap-8 md:items-start">
          {/* Preview FIRST in DOM → top on mobile, right on desktop via flex-row-reverse */}
          <div className="w-full max-w-[320px] mx-auto md:max-w-none md:w-[280px] md:flex-shrink-0 md:sticky md:top-6">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">Preview</p>
            <ProfilePreview draft={draft} />
          </div>

          {/* Form SECOND in DOM → bottom on mobile, left on desktop */}
          <div className="flex-1 min-w-0 space-y-6">

            {/* Avatar */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Avatar</label>
              <div className="flex items-center gap-4">
                <button type="button" onClick={() => fileRef.current?.click()} className="rounded-full focus:outline-none">
                  <Avatar user={draft} size={80}
                    className="ring-2 ring-white/10 hover:ring-[var(--accent)] transition-all rounded-full" />
                </button>
                <div className="space-y-1">
                  <button type="button" onClick={() => fileRef.current?.click()}
                    className="text-sm text-[var(--accent)] hover:underline block">
                    Upload avatar
                  </button>
                  {draft.avatar_url && (
                    <button type="button" onClick={handleRemoveAvatar}
                      className="text-xs text-[var(--text-muted)] hover:text-[var(--danger)] block">
                      Remove avatar
                    </button>
                  )}
                  {fieldErrors.avatar && <p className="text-xs text-[var(--danger)]">{fieldErrors.avatar}</p>}
                </div>
              </div>
              <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileSelect} />
            </div>

            {/* Display Name */}
            <Field label="Display Name" error={fieldErrors.display_name}>
              <input type="text" maxLength={36} value={draft.display_name ?? ''} onChange={e => set('display_name', e.target.value || null)}
                placeholder={draft.username} className={inputCls} />
            </Field>

            {/* Pronouns */}
            <Field label="Pronouns" error={fieldErrors.pronouns}>
              <input type="text" maxLength={40} value={draft.pronouns ?? ''} onChange={e => set('pronouns', e.target.value || null)}
                placeholder="they/them" className={inputCls} />
            </Field>

            {/* Bio */}
            <Field label="Bio" error={fieldErrors.bio}>
              <div className="relative">
                <textarea maxLength={195} value={draft.bio ?? ''} onChange={e => set('bio', e.target.value || null)}
                  rows={3} placeholder="Tell people a bit about yourself…"
                  className={`${inputCls} resize-none`} />
                <span className={`absolute bottom-2 right-2 text-[10px] ${(draft.bio?.length ?? 0) > 185 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
                  {draft.bio?.length ?? 0} / 190
                </span>
              </div>
            </Field>

            {/* Username Color */}
            <ColorPicker
              label="Username Color"
              value={draft.username_color}
              onChange={v => set('username_color', v)}
              previewText={draft.display_name ?? draft.username}
            />

            {/* Banner Color */}
            <ColorPicker
              label="Banner Color"
              value={draft.banner_color}
              onChange={v => set('banner_color', v)}
            />

            {/* Badge */}
            <BadgeSelector value={draft.badge} onChange={v => set('badge', v)} isAdmin={isAdmin} />

            {/* Location */}
            <Field label="Location" error={fieldErrors.location}>
              <input type="text" maxLength={64} value={draft.location ?? ''} onChange={e => set('location', e.target.value || null)}
                placeholder="Seattle, WA" className={inputCls} />
            </Field>

            {/* Website */}
            <Field label="Website" error={fieldErrors.website}>
              <input type="url" maxLength={100} value={draft.website ?? ''} onChange={e => set('website', e.target.value || null)}
                placeholder="https://yoursite.com" className={inputCls} />
            </Field>

            <NotificationSettingsPanel />

            <ReplayTipsButton />

            {/* Actions */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 pt-2 pb-10 md:pb-2">
              <button
                onClick={handleSave}
                disabled={!isDirty || isPending}
                className="w-full md:w-auto px-5 py-2 rounded-lg text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent)]/90 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                {isPending ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => router.back()}
                className="w-full md:w-auto px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>

        </div>
      </div>
      </div>

      {/* Crop modal */}
      {cropSrc && (
        <AvatarCropModal src={cropSrc} onApply={handleCropApply} onClose={() => setCropSrc(null)} />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg border ${
          toast.type === 'success'
            ? 'bg-green-500/20 border-green-500/30 text-green-300'
            : 'bg-[var(--danger)]/20 border-[var(--danger)]/30 text-red-300'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg text-sm bg-white/5 border border-white/10 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/50'

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">{label}</label>
      {children}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  )
}
