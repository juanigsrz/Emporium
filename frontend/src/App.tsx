import { Outlet } from 'react-router-dom'
import NavBar from './components/NavBar'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-gray-200 py-4 text-center text-xs text-gray-400">
        MathTrade &copy; {new Date().getFullYear()}
      </footer>
    </div>
  )
}
