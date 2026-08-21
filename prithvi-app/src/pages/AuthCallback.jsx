import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import './Auth.css'

const AuthCallback = () => {
  const navigate = useNavigate()
  const [errorMsg, setErrorMsg] = useState('')
  const processed = useRef(false)

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    let timeoutId
    let authSubscription

    const handleCallback = async () => {
      const hash = window.location.hash
      const search = window.location.search
      const params = new URLSearchParams(hash ? hash.substring(1) : search.substring(1))

      const errorParam = params.get('error')
      if (errorParam) {
        const desc = params.get('error_description') || errorParam
        setErrorMsg('Authentication failed: ' + decodeURIComponent(desc).replace(/\+/g, ' '))
        return
      }

      const code = params.get('code')
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          setErrorMsg('Session error: ' + exchangeError.message)
          return
        }
      }

      const { data: { session }, error } = await supabase.auth.getSession()

      if (error) {
        setErrorMsg('Session error: ' + error.message)
        return
      }

      if (session) {
        navigate('/', { replace: true })
      } else {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (event, session) => {
            if (event === 'SIGNED_IN' && session) {
              subscription.unsubscribe()
              navigate('/', { replace: true })
            }
          }
        )
        authSubscription = subscription

        timeoutId = setTimeout(() => {
          if (authSubscription) authSubscription.unsubscribe()
          setErrorMsg('Authentication timed out. Supabase did not return a valid session. Check Google Client ID/Secret in Supabase Dashboard.')
        }, 5000)
      }
    }

    handleCallback()

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      if (authSubscription) authSubscription.unsubscribe()
    }
  }, [navigate])

  return (
    <div className="auth-page" data-testid="auth-callback-page">
      <div className="container">
        <div className="auth-container">
          <div className="auth-card card" style={{ textAlign: 'center' }}>
            {errorMsg ? (
              <>
                <div className="error-message" style={{ marginBottom: '20px' }}>
                  {errorMsg}
                </div>
                <button className="btn btn-primary" onClick={() => navigate('/login')}>
                  Return to Login
                </button>
              </>
            ) : (
              <>
                <div className="callback-spinner"></div>
                <h2 className="auth-title" style={{ fontSize: '1.5rem', marginTop: '16px' }}>
                  Signing you in...
                </h2>
                <p className="auth-subtitle">
                  Please wait while we complete authentication.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthCallback
