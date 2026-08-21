import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import './Profile.css'

const Profile = () => {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    totalPlasticRecycled: 0,
    totalPickups: 0,
    carbonFootprintReduced: 0,
    totalEarnings: 0
  })

  const [profile, setProfile] = useState({ name: '', avatar: '', bio: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [bioInput, setBioInput] = useState('')

  useEffect(() => {
    async function loadProfile() {
      if (!user) return
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, avatar, bio')
        .eq('id', user.id)
        .single()
      
      if (data) {
        setProfile(data)
        setBioInput(data.bio || '')
      }
    }
    loadProfile()
  }, [user])

  const handleUpdateProfile = async () => {
    if (!user) return
    const updates = { bio: bioInput }
    const { error } = await supabase.from('profiles').update(updates).eq('id', user.id)
    if (!error) {
      setProfile(prev => ({ ...prev, bio: bioInput }))
      setIsEditing(false)
    }
  }

  const [pickupHistory] = useState([
    {
      id: 1,
      date: '2024-01-15',
      weight: 5.5,
      earnings: 82.50,
      status: 'Completed'
    },
    {
      id: 2,
      date: '2024-01-08',
      weight: 3.2,
      earnings: 48.00,
      status: 'Completed'
    },
    {
      id: 3,
      date: '2024-01-01',
      weight: 7.8,
      earnings: 117.00,
      status: 'Completed'
    }
  ])

  useEffect(() => {
    const totalWeight = pickupHistory.reduce((sum, pickup) => sum + pickup.weight, 0)
    const totalEarn = pickupHistory.reduce((sum, pickup) => sum + pickup.earnings, 0)
    const carbonReduced = totalWeight * 2.5

    setStats({
      totalPlasticRecycled: totalWeight,
      totalPickups: pickupHistory.length,
      carbonFootprintReduced: carbonReduced,
      totalEarnings: totalEarn
    })
  }, [pickupHistory])

  const displayName =
    profile.name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    'User'

  return (
    <div className="profile-page" data-testid="profile-page">
      <div className="container">
        <div className="profile-header">
          <div className="user-info">
            <div className="user-avatar" data-testid="user-avatar">
              {profile.avatar ? <img src={profile.avatar} alt="Avatar" style={{width:'100%', borderRadius:'50%'}}/> : displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="user-name">{displayName}</h1>
              <p className="user-email">{user?.email || 'user@example.com'}</p>
              {isEditing ? (
                <div style={{marginTop: '10px'}}>
                  <textarea value={bioInput} onChange={e => setBioInput(e.target.value)} style={{width: '100%', marginBottom: '10px', padding: '5px'}}/>
                  <button onClick={handleUpdateProfile} className="btn btn-primary" style={{marginRight: '10px'}}>Save</button>
                  <button onClick={() => setIsEditing(false)} className="btn">Cancel</button>
                </div>
              ) : (
                <div style={{marginTop: '10px'}}>
                  <p>{profile.bio || 'No bio yet.'}</p>
                  <button onClick={() => setIsEditing(true)} className="btn" style={{marginTop: '10px'}}>Edit Bio</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="dashboard-stats">
          <div className="stat-box card" data-testid="stat-plastic-recycled">
            <div className="stat-icon">♻️</div>
            <div className="stat-value">{stats.totalPlasticRecycled.toFixed(1)} kg</div>
            <div className="stat-name">Plastic Recycled</div>
          </div>

          <div className="stat-box card" data-testid="stat-pickups">
            <div className="stat-icon">📦</div>
            <div className="stat-value">{stats.totalPickups}</div>
            <div className="stat-name">Total Pickups</div>
          </div>

          <div className="stat-box card" data-testid="stat-carbon">
            <div className="stat-icon">🌱</div>
            <div className="stat-value">{stats.carbonFootprintReduced.toFixed(1)} kg</div>
            <div className="stat-name">CO₂ Reduced</div>
          </div>

          <div className="stat-box card" data-testid="stat-earnings">
            <div className="stat-icon">💰</div>
            <div className="stat-value">₹{stats.totalEarnings.toFixed(2)}</div>
            <div className="stat-name">Total Earnings</div>
          </div>
        </div>

        <div className="pickup-history card">
          <h2 className="section-heading">Pickup History</h2>
          
          {pickupHistory.length === 0 ? (
            <div className="empty-state" data-testid="empty-history">
              <p>No pickups scheduled yet</p>
              <a href="/schedule-pickup" className="btn btn-primary">
                Schedule Your First Pickup
              </a>
            </div>
          ) : (
            <div className="history-table-container">
              <table className="history-table" data-testid="history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Weight (kg)</th>
                    <th>Earnings</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pickupHistory.map((pickup) => (
                    <tr key={pickup.id} data-testid={`history-row-${pickup.id}`}>
                      <td>{pickup.date}</td>
                      <td>{pickup.weight} kg</td>
                      <td>₹{pickup.earnings.toFixed(2)}</td>
                      <td>
                        <span className={`status-badge ${pickup.status.toLowerCase()}`}>
                          {pickup.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="impact-message card">
          <h3>Your Environmental Impact</h3>
          <p>
            By recycling {stats.totalPlasticRecycled.toFixed(1)} kg of plastic, you've helped prevent 
            it from reaching landfills and oceans. You've also reduced carbon emissions by approximately{' '}
            {stats.carbonFootprintReduced.toFixed(1)} kg CO₂ equivalent.
          </p>
          <p className="thank-you">Thank you for making a difference! 🌍</p>
        </div>
      </div>
    </div>
  )
}

export default Profile
