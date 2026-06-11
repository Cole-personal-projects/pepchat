'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { addOnboardingQuestion, deleteOnboardingQuestion, saveOnboardingConfig } from '@/app/(app)/onboarding/actions'
import { useGroupRoles } from '@/lib/hooks/useGroupRoles'

type ConfigQuestion = {
  id: string
  question: string
  multi_select: boolean
  options: Array<{ id: string; label: string }>
}

interface OnboardingConfigProps {
  groupId: string
}

/** Group Settings → Onboarding: rules screening + role-granting questions. */
export default function OnboardingConfig({ groupId }: OnboardingConfigProps) {
  const { roles } = useGroupRoles(groupId)
  const [enabled, setEnabled] = useState(false)
  const [rulesText, setRulesText] = useState('')
  const [questions, setQuestions] = useState<ConfigQuestion[]>([])
  const [newQuestion, setNewQuestion] = useState('')
  const [newOptions, setNewOptions] = useState('')
  const [grantRoleId, setGrantRoleId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [isPending, startTransition] = useTransition()

  // Grantable by onboarding answers: custom roles minus the staff templates.
  // Admin/Moderator must never be self-served through a questionnaire.
  const grantableRoles = roles.filter(
    role => !role.is_default && role.name !== 'Admin' && role.name !== 'Moderator',
  )

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: config }, { data: questionRows }] = await Promise.all([
      supabase.from('group_onboarding').select('enabled, rules_text').eq('group_id', groupId).maybeSingle(),
      supabase
        .from('onboarding_questions')
        .select('id, question, multi_select, options:onboarding_options(id, label)')
        .eq('group_id', groupId)
        .order('position', { ascending: true }),
    ])
    if (config) {
      setEnabled(Boolean((config as { enabled: boolean }).enabled))
      setRulesText((config as { rules_text: string | null }).rules_text ?? '')
    }
    setQuestions((questionRows ?? []) as unknown as ConfigQuestion[])
  }, [groupId])

  useEffect(() => {
    load()
  }, [load])

  function run(action: () => Promise<{ error: string } | { ok: true }>, successNotice = '') {
    setError('')
    setNotice('')
    startTransition(async () => {
      const result = await action()
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      if (successNotice) setNotice(successNotice)
      await load()
    })
  }

  function handleSaveConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    run(() => saveOnboardingConfig(groupId, { enabled, rulesText }), 'Onboarding settings saved.')
  }

  function handleAddQuestion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const options = newOptions
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(label => ({ label, roleIds: grantRoleId ? [grantRoleId] : [] }))
    run(() => addOnboardingQuestion(groupId, { question: newQuestion, options }), 'Question added.')
    setNewQuestion('')
    setNewOptions('')
    setGrantRoleId('')
  }

  return (
    <div data-testid="onboarding-config" className="flex flex-col gap-4">
      {error && (
        <p className="rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          {notice}
        </p>
      )}

      <form onSubmit={handleSaveConfig} className="flex flex-col gap-3">
        <label className="flex items-start gap-3 rounded border border-black/20 bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            data-testid="onboarding-enabled-toggle"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>
            <span className="block font-semibold">Require onboarding</span>
            <span className="block text-xs text-[var(--text-muted)]">
              New members must accept the rules and answer questions before chatting.
            </span>
          </span>
        </label>

        <textarea
          data-testid="onboarding-rules-input"
          value={rulesText}
          onChange={(e) => setRulesText(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Server rules shown to new members…"
          className="resize-none rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />

        <button
          type="submit"
          data-testid="save-onboarding-config"
          disabled={isPending}
          className="self-end rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </form>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Questions</h4>
        {questions.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--text-muted)]">No questions yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {questions.map(question => (
              <li key={question.id} className="rounded border border-[var(--border-soft)] bg-[var(--bg-primary)] p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{question.question}</p>
                  <button
                    type="button"
                    aria-label={`Delete question ${question.question}`}
                    disabled={isPending}
                    onClick={() => {
                      if (confirm('Delete this question?')) run(() => deleteOnboardingQuestion(question.id))
                    }}
                    className="rounded px-1.5 py-0.5 text-xs text-[var(--text-muted)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
                  >
                    Delete
                  </button>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {question.options.map(option => option.label).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAddQuestion} className="mt-3 flex flex-col gap-2 rounded border border-[var(--border-soft)] p-3">
          <input
            data-testid="new-question-input"
            type="text"
            required
            maxLength={200}
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="e.g. What brings you here?"
            className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <textarea
            data-testid="new-options-input"
            required
            rows={3}
            value={newOptions}
            onChange={(e) => setNewOptions(e.target.value)}
            placeholder={'One answer option per line (at least two)'}
            className="resize-none rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          {grantableRoles.length > 0 && (
            <select
              data-testid="grant-role-select"
              value={grantRoleId}
              onChange={(e) => setGrantRoleId(e.target.value)}
              className="rounded border border-black/20 bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">Noob (default) — stays limited to welcome channels</option>
              {grantableRoles.map(role => (
                <option key={role.id} value={role.id}>
                  {role.name === 'Member'
                    ? 'Member — full access (promotes out of noob)'
                    : `Grants role: ${role.name}`}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            data-testid="add-question-btn"
            disabled={isPending}
            className="self-end rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            Add Question
          </button>
        </form>
      </div>
    </div>
  )
}
