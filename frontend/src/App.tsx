import { Outlet } from 'react-router-dom'
import NavBar from './components/NavBar'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-8 border-t border-gray-200/70 py-6 text-center text-xs text-gray-500">
        <span className="font-display text-sm font-semibold tracking-tight text-gray-700">MathTrade</span>
        <span className="mx-2 text-gray-300">·</span>
        a board-game math-trade almanac
        <span className="mx-2 text-gray-300">·</span>
        &copy; {new Date().getFullYear()}
      </footer>
    </div>
  )
}
