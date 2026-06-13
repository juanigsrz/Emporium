import { useRef, useState, useEffect } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { logoutApi } from '../api/auth'
import { useNotifications, useUnreadCount, useMarkAllRead } from '../api/notifications'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/events', label: 'Events' },
]

function relativeTime(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// In-app notification bell: polls unread count, shows a dropdown of recent
// notifications, and marks all read when opened. Rendered only for logged-in
// users. Multiple instances (desktop + mobile) share the same React Query keys.
function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { data: unread } = useUnreadCount(true)
  const { data: list } = useNotifications(true)
  const markAll = useMarkAllRead()

  const unreadCount = unread ?? 0
  const items = list?.results ?? []

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && unreadCount > 0) markAll.mutate()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-transparent text-moss transition-colors hover:border-ink/30 hover:bg-sage/40"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full border border-ink bg-coral px-1 text-[10px] font-bold text-ink">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-2xl border-2 border-ink bg-cream py-1 shadow-card">
          <div className="border-b border-ink/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-moss">
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-moss/70">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (n.event_slug) navigate(`/events/${n.event_slug}`)
                }}
                className={`block w-full px-4 py-2 text-left text-sm hover:bg-sage/30 ${
                  n.read ? 'text-moss' : 'bg-butter/30 font-semibold text-ink'
                }`}
              >
                <span className="block">{n.message}</span>
                <span className="mt-0.5 block text-[11px] text-moss/70">{relativeTime(n.created)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function NavBar() {
  const [open, setOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const { user, clear } = useAuthStore()
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close user dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleLogout() {
    try {
      await logoutApi()
    } catch {
      // ignore — clear session regardless
    }
    clear()
    setUserMenuOpen(false)
    setOpen(false)
    navigate('/')
  }

  return (
    <header className="px-3 pt-3 text-ink sm:px-4 sm:pt-4">
      <div className="relative mx-auto max-w-7xl rounded-3xl border-2 border-ink bg-cream px-3 shadow-card sm:px-5">
        <div className="flex h-16 items-center justify-between gap-2">
          {/* Brand */}
          <Link
            to="/"
            className="group flex items-center gap-3"
          >
            <span className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
              <span className="h-3 w-3 rounded-full border border-ink/30 bg-coral" />
              <span className="h-3 w-3 rounded-full border border-ink/30 bg-butter" />
              <span className="h-3 w-3 rounded-full border border-ink/30 bg-sage" />
            </span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl border-2 border-ink bg-butter transition-transform group-hover:-rotate-6">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="text-ink">
                <g fill="currentColor">
                  <circle cx="4.5" cy="4.5" r="1.7" />
                  <circle cx="11.5" cy="4.5" r="1.7" />
                  <circle cx="4.5" cy="11.5" r="1.7" />
                  <circle cx="11.5" cy="11.5" r="1.7" />
                </g>
              </svg>
            </span>
            <span className="font-display text-2xl font-bold leading-none tracking-tight text-ink">
              MathTrade
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-2">
            {navLinks.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `rounded-2xl border-2 px-4 py-2 text-sm font-semibold transition-all ${
                    isActive
                      ? 'border-ink bg-butter text-ink shadow-pop-sm'
                      : 'border-transparent text-moss hover:bg-sage/40'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}

            {user ? (
              <>
              <NotificationBell />
              <div className="relative ml-1" ref={menuRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-2xl border-2 border-transparent px-2.5 py-1.5 text-sm font-semibold text-moss transition-colors hover:border-ink/30 hover:bg-sage/40"
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-sage text-xs font-bold text-ink">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="text-ink">{user.username}</span>
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-44 rounded-2xl border-2 border-ink bg-cream py-1 shadow-card z-50">
                    <Link
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm font-medium text-ink hover:bg-sage/30"
                    >
                      Profile
                    </Link>
                    <Link
                      to="/my-copies"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm font-medium text-ink hover:bg-sage/30"
                    >
                      My Copies
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100/60"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
              </>
            ) : (
              <div className="flex items-center gap-2 ml-1">
                <NavLink
                  to="/login"
                  className={({ isActive }) =>
                    `rounded-2xl border-2 px-4 py-2 text-sm font-semibold transition-all ${
                      isActive
                        ? 'border-ink bg-butter text-ink shadow-pop-sm'
                        : 'border-transparent text-moss hover:bg-sage/40'
                    }`
                  }
                >
                  Login
                </NavLink>
                <NavLink
                  to="/register"
                  className="rounded-2xl border-2 border-ink bg-coral px-4 py-2 text-sm font-semibold text-ink shadow-pop-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
                >
                  Register
                </NavLink>
              </div>
            )}
          </nav>

          {/* Bell + hamburger (mobile) */}
          <div className="flex items-center gap-1.5 sm:hidden">
          {user && <NotificationBell />}
          <button
            className="flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-transparent text-moss transition-colors hover:border-ink/30 hover:bg-sage/40"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
          </div>
        </div>

        {/* Mobile menu */}
        {open && (
          <nav className="sm:hidden border-t-2 border-ink/10 px-1 py-2 flex flex-col gap-1">
            {navLinks.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${
                    isActive
                      ? 'bg-butter text-ink'
                      : 'text-moss hover:bg-sage/40'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}

            {user ? (
              <>
                <span className="px-3 py-2 text-sm font-bold text-ink">{user.username}</span>
                <Link
                  to="/profile"
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl px-3 py-2 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors"
                >
                  Profile
                </Link>
                <Link
                  to="/my-copies"
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl px-3 py-2 text-sm font-semibold text-moss hover:bg-sage/40 transition-colors"
                >
                  My Copies
                </Link>
                <button
                  onClick={handleLogout}
                  className="text-left rounded-2xl px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100/60 transition-colors"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <NavLink
                  to="/login"
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `block rounded-2xl px-3 py-2 text-sm font-semibold transition-colors ${
                      isActive ? 'bg-butter text-ink' : 'text-moss hover:bg-sage/40'
                    }`
                  }
                >
                  Login
                </NavLink>
                <NavLink
                  to="/register"
                  onClick={() => setOpen(false)}
                  className="block rounded-2xl border-2 border-ink bg-coral px-3 py-2 text-sm font-semibold text-ink shadow-pop-sm transition-colors"
                >
                  Register
                </NavLink>
              </>
            )}
          </nav>
        )}
      </div>
    </header>
  )
}
