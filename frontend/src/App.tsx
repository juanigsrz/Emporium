import { Outlet } from 'react-router-dom'
import NavBar from './components/NavBar'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="mt-10 border-t-2 border-ink/10 py-6 text-center text-xs text-moss">
        <span className="font-display text-sm font-bold tracking-tight text-ink">MathTrade</span>
        <span className="mx-2 text-moss/40">·</span>
        a board-game math-trade almanac
        <span className="mx-2 text-moss/40">·</span>
        &copy; {new Date().getFullYear()}
      </footer>
    </div>
  )
}
