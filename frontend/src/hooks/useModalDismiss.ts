import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * Wires the baseline accessibility behaviours every modal needs:
 *  - Escape closes it (via `onClose`)
 *  - background page scroll is locked while it's open
 *  - focus moves into the dialog on open, is trapped inside on Tab, and returns
 *    to the previously-focused element on close
 *
 * `panelRef` should point at the dialog panel element (give it `tabIndex={-1}`
 * so it can receive focus when it has no focusable children yet).
 */
export function useModalDismiss(panelRef: RefObject<HTMLElement>, onClose: () => void) {
  // Callers pass inline closures; track the latest in a ref so the mount effect
  // below never re-runs (and re-yanks focus) on parent re-renders.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const prevFocus = document.activeElement as HTMLElement | null

    const node = panelRef.current
    const initial = node?.querySelector<HTMLElement>(FOCUSABLE) ?? node
    initial?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !node) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      prevFocus?.focus?.()
    }
  }, [panelRef])
}
