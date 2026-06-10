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
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-indigo-100 transition-colors hover:bg-indigo-600"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-black/10">
          <div className="border-b border-gray-100 px-4 py-2 text-xs font-semibold text-gray-500">
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  if (n.event_slug) navigate(`/events/${n.event_slug}`)
                }}
                className={`block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${
                  n.read ? 'text-gray-600' : 'bg-indigo-50/40 font-medium text-gray-900'
                }`}
              >
                <span className="block">{n.message}</span>
                <span className="mt-0.5 block text-[11px] text-gray-400">{relativeTime(n.created)}</span>
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
    <header className="bg-indigo-700 text-white shadow-md">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Brand */}
          <Link
            to="/"
            className="group flex items-center gap-2.5 transition-colors hover:text-indigo-100"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-indigo-600 ring-1 ring-white/15 transition-transform group-hover:-rotate-6">
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" className="text-indigo-100">
                <g fill="currentColor">
                  <circle cx="4.5" cy="4.5" r="1.7" />
                  <circle cx="11.5" cy="4.5" r="1.7" />
                  <circle cx="4.5" cy="11.5" r="1.7" />
                  <circle cx="11.5" cy="11.5" r="1.7" />
                </g>
              </svg>
            </span>
            <span className="font-display text-[1.4rem] font-semibold leading-none tracking-tight">
              MathTrade
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-900 text-white'
                      : 'text-indigo-100 hover:bg-indigo-600'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}

            {user ? (
              <>
              <NotificationBell />
              <div className="relative ml-2" ref={menuRef}>
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-indigo-100 hover:bg-indigo-600 transition-colors"
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                >
                  <span className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-bold">
                    {user.username.charAt(0).toUpperCase()}
                  </span>
                  <span>{user.username}</span>
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-1 w-44 rounded-md bg-white shadow-lg ring-1 ring-black/10 py-1 z-50">
                    <Link
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Profile
                    </Link>
                    <Link
                      to="/my-copies"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      My Copies
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-50"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
              </>
            ) : (
              <div className="flex items-center gap-1 ml-2">
                <NavLink
                  to="/login"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-indigo-900 text-white'
                        : 'text-indigo-100 hover:bg-indigo-600'
                    }`
                  }
                >
                  Login
                </NavLink>
                <NavLink
                  to="/register"
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-white text-indigo-700'
                        : 'bg-white text-indigo-700 hover:bg-indigo-50'
                    }`
                  }
                >
                  Register
                </NavLink>
              </div>
            )}
          </nav>

          {/* Bell + hamburger (mobile) */}
          <div className="flex items-center gap-1 sm:hidden">
          {user && <NotificationBell />}
          <button
            className="p-2 rounded-md text-indigo-100 hover:bg-indigo-600 transition-colors"
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
      </div>

      {/* Mobile menu */}
      {open && (
        <nav className="sm:hidden border-t border-indigo-600 px-4 py-2 flex flex-col gap-1">
          {navLinks.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-900 text-white'
                    : 'text-indigo-100 hover:bg-indigo-600'
                }`
              }
            >
              {label}
            </NavLink>
          ))}

          {user ? (
            <>
              <span className="px-3 py-2 text-sm text-indigo-300 font-medium">{user.username}</span>
              <Link
                to="/profile"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded-md text-sm font-medium text-indigo-100 hover:bg-indigo-600 transition-colors"
              >
                Profile
              </Link>
              <Link
                to="/my-copies"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 rounded-md text-sm font-medium text-indigo-100 hover:bg-indigo-600 transition-colors"
              >
                My Copies
              </Link>
              <button
                onClick={handleLogout}
                className="text-left px-3 py-2 rounded-md text-sm font-medium text-indigo-100 hover:bg-indigo-600 transition-colors"
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
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-900 text-white' : 'text-indigo-100 hover:bg-indigo-600'
                  }`
                }
              >
                Login
              </NavLink>
              <NavLink
                to="/register"
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-900 text-white' : 'text-indigo-100 hover:bg-indigo-600'
                  }`
                }
              >
                Register
              </NavLink>
            </>
          )}
        </nav>
      )}
    </header>
  )
}
