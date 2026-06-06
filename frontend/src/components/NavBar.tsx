import { useRef, useState, useEffect } from 'react'
import { NavLink, Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { logoutApi } from '../api/auth'

const navLinks = [
  { to: '/', label: 'Home' },
  { to: '/games', label: 'Games' },
  { to: '/events', label: 'Events' },
]

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
            className="text-xl font-bold tracking-tight hover:text-indigo-200 transition-colors"
          >
            MathTrade
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

          {/* Hamburger (mobile) */}
          <button
            className="sm:hidden p-2 rounded-md text-indigo-100 hover:bg-indigo-600 transition-colors"
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
