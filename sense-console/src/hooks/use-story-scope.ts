import { useCallback, useEffect, useMemo } from "react"
import { useSearchParams } from "react-router"

import type { Story } from "@/contracts/story-production"
import { stories } from "@/data/story-production-mock"

const STORAGE_KEY = "s2s.lastStoryId"

function readStoredStoryId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredStoryId(storyId: string) {
  try {
    localStorage.setItem(STORAGE_KEY, storyId)
  } catch {
    // Storage can be unavailable (private browsing, disabled cookies) — the
    // URL query param remains the source of truth, so this is safe to skip.
  }
}

/**
 * Shared "current story" context for the video-production pages (storyboards,
 * characters, scenes, canvas). The selected story id lives in the `storyId`
 * URL query param so it is shareable and survives a refresh; when the param
 * is missing or points at an unknown story, it falls back to the last story
 * used on this device, then to the first story in the list, and writes that
 * choice back into the URL so the address bar always reflects reality.
 */
export function useStoryScope() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedStoryId = searchParams.get("storyId")

  const resolvedStoryId = useMemo(() => {
    if (requestedStoryId && stories.some((story) => story.id === requestedStoryId)) {
      return requestedStoryId
    }
    const storedStoryId = readStoredStoryId()
    if (storedStoryId && stories.some((story) => story.id === storedStoryId)) {
      return storedStoryId
    }
    return stories[0]?.id ?? null
  }, [requestedStoryId])

  useEffect(() => {
    if (!resolvedStoryId || resolvedStoryId === requestedStoryId) return
    const next = new URLSearchParams(searchParams)
    next.set("storyId", resolvedStoryId)
    setSearchParams(next, { replace: true })
  }, [resolvedStoryId, requestedStoryId, searchParams, setSearchParams])

  useEffect(() => {
    if (resolvedStoryId) writeStoredStoryId(resolvedStoryId)
  }, [resolvedStoryId])

  const setStoryId = useCallback(
    (storyId: string) => {
      const next = new URLSearchParams(searchParams)
      next.set("storyId", storyId)
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  const story: Story | undefined = stories.find((item) => item.id === resolvedStoryId)

  return { storyId: resolvedStoryId, story, stories, setStoryId }
}

export function buildStoryScopedPath(path: string, storyId: string | null) {
  if (!storyId) return path
  return `${path}?storyId=${encodeURIComponent(storyId)}`
}
