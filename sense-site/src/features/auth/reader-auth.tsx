import { useQueryClient } from "@tanstack/react-query"
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import type { ReaderSession } from "@/contracts/site"
import { getReaderAuth, type ReaderAuthService } from "@/services/reader-auth-service"

type ReaderAuthState = {
  session: ReaderSession | null
  ready: boolean
  auth: ReaderAuthService
}

const ReaderAuthContext = createContext<ReaderAuthState | null>(null)

export function ReaderAuthProvider({ children }: { children: ReactNode }) {
  const auth = useMemo(() => getReaderAuth(), [])
  const queryClient = useQueryClient()
  const [session, setSession] = useState<ReaderSession | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    auth
      .getSession()
      .then((value) => active && setSession(value))
      .catch(() => active && setSession(null))
      .finally(() => active && setReady(true))
    const unsubscribe = auth.onChange((value) => {
      setSession((previous) => {
        // Identity changed (sign-out or another account): drop every reader-scoped cache.
        if (previous?.userId !== value?.userId || previous?.verified !== value?.verified)
          queryClient.removeQueries({ queryKey: ["reader"] })
        return value
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [auth, queryClient])

  const value = useMemo(() => ({ session, ready, auth }), [session, ready, auth])
  return <ReaderAuthContext.Provider value={value}>{children}</ReaderAuthContext.Provider>
}

export function useReaderAuth() {
  const value = useContext(ReaderAuthContext)
  if (!value) throw new Error("useReaderAuth must be used inside ReaderAuthProvider")
  return value
}
