import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import About from './pages/About'
import Shop from './pages/Shop'
import SchedulePickup from './pages/SchedulePickup'
import Profile from './pages/Profile'
import Login from './pages/Login'
import Signup from './pages/Signup'
import AuthCallback from './pages/AuthCallback'

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth()

  // While Supabase is checking the session, show nothing (prevents flash redirect)
  if (loading) return null

  return isAuthenticated ? children : <Navigate to="/login" />
}

function AppRoutes() {
  return (
    <div className="app">
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/shop" element={<Shop />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/schedule-pickup"
            element={
              <ProtectedRoute>
                <SchedulePickup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}

import { useThemeStore } from './store/themeStore'

function App() {
  React.useEffect(() => {
    useThemeStore.getState().initTheme()
  }, [])

  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </Router>
  )
}

export default App
