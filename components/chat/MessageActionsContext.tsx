'use client'

import { createContext, useContext, type MouseEvent, type ReactNode } from 'react'

export type MessageActions = {
  startEdit: (messageId: string) => void
  cancelEdit: () => void
  changeEditContent: (content: string) => void
  submitEdit: (messageId: string, content: string) => Promise<void>
  delete: (messageId: string) => Promise<void>
  react: (messageId: string, emoji: string) => Promise<void>
  reply: (messageId: string) => void
  openThread: (messageId: string) => void
  jumpToMessage: (messageId: string) => void
  pin: (messageId: string) => Promise<void>
  toggleSaved: (messageId: string) => void
  openProfile: (userId: string, anchor: HTMLElement) => void
  openActions: (messageId: string) => void
  openContextMenu: (messageId: string, event: MouseEvent) => void
  togglePicker: (messageId: string | null) => void
  closePicker: () => void
  markUnread: (messageId: string) => void
  report: (messageId: string) => void
  muteUser: (messageId: string) => void
}

const Ctx = createContext<MessageActions | null>(null)

export function useMessageActions(): MessageActions {
  const value = useContext(Ctx)
  if (!value) {
    throw new Error(
      'useMessageActions must be used inside a <ChannelMessageActionsProvider>',
    )
  }
  return value
}

export function ChannelMessageActionsProvider({
  value,
  children,
}: {
  value: MessageActions
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
