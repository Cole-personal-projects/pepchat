'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { completeOnboarding } from '@/app/(app)/onboarding/actions'

type OnboardingQuestion = {
  id: string
  question: string
  multi_select: boolean
  position: number
  options: Array<{ id: string; label: string; emoji: string | null; position: number }>
}

interface OnboardingGateProps {
  groupId: string
  userId: string
}

/**
 * Discord-style server onboarding: when a group has onboarding enabled and
 * the member has not completed it, a blocking overlay shows the rules and
 * role-granting questions.
 */
export default function OnboardingGate({ groupId, userId }: OnboardingGateProps) {
  const [rulesText, setRulesText] = useState<string | null>(null)
  const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: config }, { data: progress }] = await Promise.all([
      supabase.from('group_onboarding').select('enabled, rules_text').eq('group_id', groupId).maybeSingle(),
      supabase
        .from('member_onboarding')
        .select('completed_at')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle(),
    ])

    const enabled = Boolean((config as { enabled?: boolean } | null)?.enabled)
    const completed = Boolean((progress as { completed_at?: string | null } | null)?.completed_at)
    if (!enabled || completed) {
      setNeedsOnboarding(false)
      return
    }

    const { data: questionRows } = await supabase
      .from('onboarding_questions')
      .select('id, question, multi_select, position, options:onboarding_options(id, label, emoji, position)')
      .eq('group_id', groupId)
      .order('position', { ascending: true })

    setRulesText((config as { rules_text?: string | null } | null)?.rules_text ?? null)
    setQuestions(((questionRows ?? []) as unknown as OnboardingQuestion[]).map(question => ({
      ...question,
      options: [...question.options].sort((a, b) => a.position - b.position),
    })))
    setAccepted(false)
    setSelected(new Set())
    setNeedsOnboarding(true)
  }, [groupId, userId])

  useEffect(() => {
    load()
  }, [load])

  const questionsById = useMemo(() => new Map(questions.map(question => [question.id, question])), [questions])

  function toggleOption(questionId: string, optionId: string) {
    const question = questionsById.get(questionId)
    if (!question) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(optionId)) {
        next.delete(optionId)
        return next
      }
      if (!question.multi_select) {
        for (const option of question.options) next.delete(option.id)
      }
      next.add(optionId)
      return next
    })
  }

  function handleComplete() {
    setError('')
    startTransition(async () => {
      const result = await completeOnboarding(groupId, [...selected])
      if (result && 'error' in result) {
        setError(result.error)
        return
      }
      setNeedsOnboarding(false)
    })
  }

  if (!needsOnboarding) return null

  return (
    <div
      data-testid="onboarding-gate"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-[var(--bg-secondary)] p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Welcome! Before you join in…</h2>

        {rulesText && (
          <div className="mt-3 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-primary)] p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Server Rules</h3>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{rulesText}</p>
          </div>
        )}

        {questions.map(question => (
          <fieldset key={question.id} className="mt-4">
            <legend className="text-sm font-semibold text-[var(--text-primary)]">{question.question}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {question.options.map(option => {
                const isSelected = selected.has(option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    data-testid={`onboarding-option-${option.id}`}
                    onClick={() => toggleOption(question.id, option.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${
                      isSelected
                        ? 'bg-[var(--accent)] text-white'
                        : 'bg-white/5 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {option.emoji ? `${option.emoji} ` : ''}{option.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}

        <label className="mt-5 flex items-start gap-3 rounded border border-black/20 bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            data-testid="onboarding-accept-rules"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
          />
          <span>I have read and agree to the server rules.</span>
        </label>

        {error && (
          <p className="mt-3 rounded border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        )}

        <button
          type="button"
          data-testid="onboarding-complete"
          disabled={!accepted || isPending}
          onClick={handleComplete}
          className="mt-4 w-full rounded bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Joining…' : 'Finish & Join'}
        </button>
      </div>
    </div>
  )
}
