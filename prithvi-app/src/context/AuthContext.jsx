import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get the initial session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      const supaUser = session?.user ?? null
      setUser(supaUser)
      syncToLocalStorage(supaUser)
      setLoading(false)
    })

    // Listen for auth state changes (login, logout, token refresh, OAuth callback)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const supaUser = session?.user ?? null
        setUser(supaUser)
        syncToLocalStorage(supaUser)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  /**
   * Sync the Supabase user to localStorage's `currentUser` key so that
   * legacy code (Navbar, Profile, ProtectedRoute) that reads from
   * localStorage continues to work during migration.
   */
  const syncToLocalStorage = (supaUser) => {
    if (supaUser) {
      const userData = {
        email: supaUser.email,
        name:
          supaUser.user_metadata?.full_name ||
          supaUser.user_metadata?.name ||
          supaUser.email?.split('@')[0] ||
          'User',
      }
      localStorage.setItem('currentUser', JSON.stringify(userData))
    } else {
      localStorage.removeItem('currentUser')
    }
  }

  // --- Auth actions ---

  const loginWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) return { success: false, message: error.message }
    return { success: true, user: data.user }
  }

  const signupWithEmail = async (name, email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
      },
    })
    if (error) return { success: false, message: error.message }
    return { success: true, user: data.user }
  }

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent select_account',
        },
      },
    })
    if (error) return { success: false, message: error.message }
    // OAuth redirect happens automatically — no return value needed on success
    return { success: true }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) console.error('Logout error:', error.message)
    // onAuthStateChange listener will clear localStorage
  }

  const value = {
    user,
    loading,
    loginWithEmail,
    signupWithEmail,
    signInWithGoogle,
    signOut,
    isAuthenticated: !!user,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
