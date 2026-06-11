'use client'

import { createContext, useContext } from 'react'

interface MobileSidebarContextValue {
  open: () => void
  /** Opens the members sheet (slide-in from the right on mobile). */
  openMembers: () => void
}

export const MobileSidebarContext = createContext<MobileSidebarContextValue>({
  open: () => {},
  openMembers: () => {},
})
export const useMobileSidebar = () => useContext(MobileSidebarContext)
