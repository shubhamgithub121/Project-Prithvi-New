import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo.png'
import './Navbar.css'
import { useThemeStore } from '../store/themeStore'

const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const navigate = useNavigate()
  const { isAuthenticated, user, signOut } = useAuth()
  const { theme, toggleTheme } = useThemeStore()

  const handleLogout = async () => {
    await signOut()
    navigate('/')
    setIsMenuOpen(false)
  }

  // Derive display name from Supabase user metadata or email
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    'User'

  return (
    <nav className="navbar">
      <div className="container">
        <div className="navbar-content">

          {/* LEFT: LOGO + TEXT */}
          <Link to="/" className="navbar-brand">
            <img
              src={logo}
              alt="Prithvi Logo"
              className="navbar-logo-img"
            />
            <span className="brand-text">Prithvi</span>
          </Link>

          {/* CENTER: NAV LINKS */}
          <div className={`navbar-links ${isMenuOpen ? 'active' : ''}`}>
            <Link to="/">Home</Link>
            <Link to="/schedule-pickup">Schedule Pickup</Link>
            <Link to="/shop">Shop</Link>
            <Link to="/about">About</Link>
          </div>

          {/* RIGHT: AUTH */}
          <div className="navbar-auth">
            <button onClick={toggleTheme} className="btn-theme-toggle" style={{marginRight: '10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem'}}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {isAuthenticated ? (
              <>
                <button onClick={handleLogout} className="btn-logout">
                  Logout
                </button>
                <Link to="/profile" className="navbar-profile-icon">
                  👤
                </Link>
              </>
            ) : (
              <Link to="/login">
                <button className="btn-login">Login</button>
              </Link>
            )}
          </div>

        </div>
      </div>
    </nav>
  )
}

export default Navbar
