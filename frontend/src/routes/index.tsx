import { createBrowserRouter } from 'react-router-dom'
import App from '../App'
import HomePage from '../features/home/HomePage'
import GamesPage from '../features/games/GamesPage'
import GameDetailPage from '../features/games/GameDetailPage'
import EventsPage from '../features/events/EventsPage'
import EventDetailPage from '../features/events/EventDetailPage'
import LoginPage from '../features/login/LoginPage'
import RegisterPage from '../features/auth/RegisterPage'
import ProfilePage from '../features/profile/ProfilePage'
import PublicProfilePage from '../features/profile/PublicProfilePage'
import MyCopiesPage from '../features/copies/MyCopiesPage'
import RequireAuth from '../components/RequireAuth'
import WantListBuilderPage from '../features/trades/WantListBuilderPage'
import MatchRunPage from '../features/matching/MatchRunPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'games', element: <GamesPage /> },
      { path: 'games/:bggId', element: <GameDetailPage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:slug', element: <EventDetailPage /> },
      {
        path: 'events/:slug/builder',
        element: (
          <RequireAuth>
            <WantListBuilderPage />
          </RequireAuth>
        ),
      },
      { path: 'events/:slug/matches', element: <MatchRunPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      {
        path: 'profile',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
      {
        path: 'my-copies',
        element: (
          <RequireAuth>
            <MyCopiesPage />
          </RequireAuth>
        ),
      },
      { path: 'u/:username', element: <PublicProfilePage /> },
    ],
  },
])
