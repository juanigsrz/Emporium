import { useEffect } from 'react'

const SUFFIX = 'Emporium'

/**
 * Sets `document.title` to `"<title> · Emporium"` while the calling page is
 * mounted, restoring the previous title on unmount. Pass an already-localized
 * string; a nullish title (e.g. data still loading) leaves the bare suffix.
 */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    const prev = document.title
    document.title = title ? `${title} · ${SUFFIX}` : SUFFIX
    return () => {
      document.title = prev
    }
  }, [title])
}
