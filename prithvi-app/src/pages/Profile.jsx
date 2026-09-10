import React, { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useThemeStore } from '../store/themeStore'
import { supabase } from '../lib/supabaseClient'
import { apiGet } from '../lib/apiClient'
import './Profile.css'

const RATE_PER_KG = 15

const TIERS = [
  { name: 'Sapling', emoji: '🌱', min: 0, max: 5 },
  { name: 'Sprout', emoji: '🌿', min: 5, max: 20 },
  { name: 'Tree', emoji: '🌳', min: 20, max: 50 },
  { name: 'Forest Guardian', emoji: '🌲', min: 50, max: null },
]

const REWARD_PRODUCTS = [
  { id: 1, icon: '🪴', name: 'Recycled Plastic Planter', price: 299 },
  { id: 2, icon: '👜', name: 'Reusable Cloth Bag', price: 149 },
  { id: 3, icon: '🍶', name: 'Eco Water Bottle', price: 399 },
  { id: 4, icon: '📓', name: 'Recycled Notebook', price: 199 },
]

function getTierInfo(kg) {
  let idx = 0
  for (let i = 0; i < TIERS.length; i++) {
    idx = i
    if (TIERS[i].max === null || kg < TIERS[i].max) break
  }
  const current = TIERS[idx]
  const next = TIERS[idx + 1]
  if (!next) {
    return {
      name: current.name,
      emoji: current.emoji,
      nextEmoji: '🏆',
      progressPct: 100,
      subtext: 'Highest tier reached',
      footnote: "You've reached the top eco tier. Thank you for leading the way!",
    }
  }
  const span = next.min - current.min
  const progressed = kg - current.min
  const pct = Math.min(100, Math.round((progressed / span) * 100))
  const remaining = (next.min - kg).toFixed(1)
  return {
    name: current.name,
    emoji: current.emoji,
    nextEmoji: next.emoji,
    progressPct: pct,
    subtext: `${remaining} kg to ${next.name}`,
    footnote: `Recycle ${remaining} kg more to reach ${next.name} ${next.emoji}`,
  }
}

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
    <circle cx="12" cy="13" r="4"></circle>
  </svg>
)

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
)

const ChevronIcon = ({ expanded }) => (
  <svg
    className={`chevron ${expanded ? 'chevron-rot' : ''}`}
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    fill="none"
  >
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
)

const Profile = () => {
  const { user, signOut } = useAuth()
  const { theme, toggleTheme } = useThemeStore()
  const navigate = useNavigate()

  const [stats, setStats] = useState({
    totalPlasticRecycled: 0,
    totalPickups: 0,
    carbonFootprintReduced: 0,
    totalEarnings: 0,
  })

  const [profile, setProfile] = useState({ name: '', avatar: '', bio: '' })
  const [isEditing, setIsEditing] = useState(false)
  const [bioInput, setBioInput] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [expandedId, setExpandedId] = useState(null)
  const [notifPickup, setNotifPickup] = useState(true)
  const [notifRewards, setNotifRewards] = useState(true)

  useEffect(() => {
    async function loadProfile() {
      if (!user) return
      const { data } = await supabase
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
    const { error } = await supabase.from('profiles').update({ bio: bioInput }).eq('id', user.id)
    if (!error) {
      setProfile((prev) => ({ ...prev, bio: bioInput }))
      setIsEditing(false)
    }
  }

  const [pickupHistory, setPickupHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    async function loadPickups() {
      if (!user) return
      try {
        const rows = await apiGet('/api/pickups/me')
        setPickupHistory(
          rows.map((p) => ({
            id: p.id,
            date: p.pickup_date,
            weight: p.estimated_weight_kg,
            earnings: p.estimated_earnings,
            status: p.status === 'scheduled' ? 'Scheduled' : 'Cancelled',
          }))
        )
      } catch (e) {
        console.error('Failed to load pickup history:', e)
      } finally {
        setHistoryLoading(false)
      }
    }
    loadPickups()
  }, [user])

  useEffect(() => {
    const activePickups = pickupHistory.filter((p) => p.status !== 'Cancelled')
    const totalWeight = activePickups.reduce((sum, pickup) => sum + pickup.weight, 0)
    const totalEarn = activePickups.reduce((sum, pickup) => sum + pickup.earnings, 0)
    const carbonReduced = totalWeight * 2.5

    setStats({
      totalPlasticRecycled: totalWeight,
      totalPickups: activePickups.length,
      carbonFootprintReduced: carbonReduced,
      totalEarnings: totalEarn,
    })
  }, [pickupHistory])

  const displayName =
    profile.name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split('@')[0] ||
    'User'

  const tier = getTierInfo(stats.totalPlasticRecycled)

  const handleLogout = async () => {
    await signOut()
    navigate('/')
  }

  const TABS = [
    { key: 'overview', label: 'Overview', icon: '🌍' },
    { key: 'history', label: 'History', icon: '📦' },
    { key: 'rewards', label: 'Rewards', icon: '💰' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="profile-page" data-testid="profile-page">
      <div className="container">
        <div className="pf-wrap">
          {/* Hero card */}
          <div className="pf-card pf-hero">
            <div className="pf-cover">
              <div className="pf-blob pf-b1"></div>
              <div className="pf-blob pf-b2"></div>
              <div className="pf-blob pf-b3"></div>
            </div>
            <button className="pf-theme-btn" onClick={toggleTheme} title="Toggle theme">
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>

            <div className="pf-identity">
              <div className="pf-avatar-wrap">
                <div className="pf-avatar" data-testid="user-avatar">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt="Avatar" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    displayName.charAt(0).toUpperCase()
                  )}
                </div>
                <button className="pf-avatar-edit" title="Photo upload coming soon">
                  <CameraIcon />
                </button>
              </div>
              <div className="pf-id-actions">
                <button className="pf-edit-btn" onClick={() => setIsEditing((v) => !v)}>
                  <PencilIcon />
                  Edit Profile
                </button>
              </div>
            </div>

            <div className="pf-namebar">
              <div className="pf-name-row">
                <h1 className="pf-name">{displayName}</h1>
                <span className="pf-tier-badge">
                  {tier.emoji} {tier.name}
                </span>
              </div>
              <p className="pf-email">{user?.email || 'user@example.com'}</p>

              {isEditing ? (
                <div className="pf-bio-edit">
                  <textarea
                    className="pf-bio-input"
                    value={bioInput}
                    onChange={(e) => setBioInput(e.target.value)}
                  />
                  <div className="pf-bio-actions">
                    <button onClick={handleUpdateProfile} className="btn btn-primary pf-btn-sm">
                      Save
                    </button>
                    <button onClick={() => setIsEditing(false)} className="btn pf-btn-sm pf-btn-ghost">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="pf-bio">{profile.bio || 'No bio yet.'}</p>
              )}
            </div>

            <div className="pf-stats-row">
              <div className="pf-stat" data-testid="stat-plastic-recycled">
                <span className="pf-stat-num">{stats.totalPlasticRecycled.toFixed(1)}</span>
                <span className="pf-stat-label">kg Recycled</span>
              </div>
              <div className="pf-stat-divider"></div>
              <div className="pf-stat" data-testid="stat-pickups">
                <span className="pf-stat-num">{stats.totalPickups}</span>
                <span className="pf-stat-label">Pickups</span>
              </div>
              <div className="pf-stat-divider"></div>
              <div className="pf-stat" data-testid="stat-carbon">
                <span className="pf-stat-num">{stats.carbonFootprintReduced.toFixed(1)}</span>
                <span className="pf-stat-label">kg CO₂ Saved</span>
              </div>
              <div className="pf-stat-divider"></div>
              <div className="pf-stat" data-testid="stat-earnings">
                <span className="pf-stat-num">₹{stats.totalEarnings.toFixed(2)}</span>
                <span className="pf-stat-label">Earned</span>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="pf-tabs">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`pf-tab ${activeTab === tab.key ? 'pf-tab-active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview */}
          {activeTab === 'overview' && (
            <div className="pf-panel">
              <div className="pf-tier-card">
                <div className="pf-tier-top">
                  <div>
                    <div className="pf-tier-current">
                      {tier.emoji} {tier.name}
                    </div>
                    <div className="pf-tier-sub">{tier.subtext}</div>
                  </div>
                  <div className="pf-tier-next">{tier.nextEmoji}</div>
                </div>
                <div className="pf-progress-track">
                  <div className="pf-progress-fill" style={{ width: `${tier.progressPct}%` }}></div>
                </div>
                <div className="pf-tier-footnote">{tier.footnote}</div>
              </div>

              <div className="pf-quick-actions">
                <Link to="/schedule-pickup" className="pf-quick-card">
                  <span className="pf-quick-icon">📅</span>
                  <span>Schedule Pickup</span>
                </Link>
                <Link to="/shop" className="pf-quick-card">
                  <span className="pf-quick-icon">♻️</span>
                  <span>Visit Eco Shop</span>
                </Link>
              </div>

              <div className="pf-impact card">
                <h3>Your Environmental Impact</h3>
                <p>
                  By recycling {stats.totalPlasticRecycled.toFixed(1)} kg of plastic, you've helped prevent
                  it from reaching landfills and oceans. You've also reduced carbon emissions by approximately{' '}
                  {stats.carbonFootprintReduced.toFixed(1)} kg CO₂ equivalent.
                </p>
                <p className="pf-thanks">Thank you for making a difference! 🌍</p>
              </div>
            </div>
          )}

          {/* History */}
          {activeTab === 'history' && (
            <div className="pf-panel">
              {historyLoading ? (
                <div className="pf-empty card">
                  <p>Loading pickup history...</p>
                </div>
              ) : pickupHistory.length === 0 ? (
                <div className="pf-empty card" data-testid="empty-history">
                  <p>No pickups scheduled yet</p>
                  <Link to="/schedule-pickup" className="btn btn-primary">
                    Schedule Your First Pickup
                  </Link>
                </div>
              ) : (
                <>
                  {pickupHistory.map((p) => {
                    const expanded = expandedId === p.id
                    return (
                      <div className="pf-history-card" key={p.id} data-testid={`history-row-${p.id}`}>
                        <div
                          className="pf-history-row"
                          onClick={() => setExpandedId(expanded ? null : p.id)}
                        >
                          <div>
                            <div className="pf-history-date">{p.date}</div>
                            <div className="pf-history-weight">{p.weight} kg plastic</div>
                          </div>
                          <div className="pf-history-side">
                            <span className={`pf-status-badge ${p.status.toLowerCase()}`}>{p.status}</span>
                            <span className="pf-earn">+₹{p.earnings.toFixed(2)}</span>
                            <ChevronIcon expanded={expanded} />
                          </div>
                        </div>
                        {expanded && (
                          <div className="pf-history-detail">
                            <div>
                              <strong>Pickup:</strong> #{p.id}
                            </div>
                            <div>
                              <strong>Rate:</strong> ₹{RATE_PER_KG}/kg × {p.weight} kg = ₹{p.earnings.toFixed(2)}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  <Link to="/schedule-pickup" className="btn btn-primary pf-block-btn">
                    Schedule Another Pickup
                  </Link>
                </>
              )}
            </div>
          )}

          {/* Rewards */}
          {activeTab === 'rewards' && (
            <div className="pf-panel">
              <div className="pf-wallet card">
                <div className="pf-wallet-label">Eco Wallet Balance</div>
                <div className="pf-wallet-amount">₹{stats.totalEarnings.toFixed(2)}</div>
                <div className="pf-wallet-sub">Redeem at the Eco Shop</div>
              </div>
              {REWARD_PRODUCTS.map((r) => {
                const canRedeem = stats.totalEarnings >= r.price
                return (
                  <div className="pf-reward-card" key={r.id}>
                    <div className="pf-reward-icon">{r.icon}</div>
                    <div className="pf-reward-info">
                      <div className="pf-reward-name">{r.name}</div>
                      <div className="pf-reward-price">₹{r.price}</div>
                    </div>
                    <button
                      className={`pf-reward-btn ${canRedeem ? '' : 'pf-disabled'}`}
                      disabled={!canRedeem}
                      onClick={() => navigate('/shop')}
                    >
                      {canRedeem ? 'Redeem' : `Need ₹${(r.price - stats.totalEarnings).toFixed(0)} more`}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Settings */}
          {activeTab === 'settings' && (
            <div className="pf-panel">
              <div className="pf-settings-card card">
                <h3 className="pf-settings-heading">Appearance</h3>
                <div className="pf-theme-segment">
                  <button
                    className={theme === 'light' ? 'pf-seg-active' : ''}
                    onClick={() => theme !== 'light' && toggleTheme()}
                  >
                    ☀️ Light
                  </button>
                  <button
                    className={theme === 'dark' ? 'pf-seg-active' : ''}
                    onClick={() => theme !== 'dark' && toggleTheme()}
                  >
                    🌙 Dark
                  </button>
                </div>
                <div className="pf-settings-hint">Matches your device automatically, or pick one yourself.</div>
              </div>

              <div className="pf-settings-card card">
                <h3 className="pf-settings-heading">Notifications</h3>
                <div className="pf-setting-row">
                  <span>Pickup Reminders</span>
                  <button
                    className={`pf-switch ${notifPickup ? 'pf-on' : ''}`}
                    onClick={() => setNotifPickup((v) => !v)}
                  >
                    <span className="pf-switch-knob"></span>
                  </button>
                </div>
                <div className="pf-setting-row">
                  <span>Reward Alerts</span>
                  <button
                    className={`pf-switch ${notifRewards ? 'pf-on' : ''}`}
                    onClick={() => setNotifRewards((v) => !v)}
                  >
                    <span className="pf-switch-knob"></span>
                  </button>
                </div>
              </div>

              <button className="pf-logout-btn" onClick={handleLogout}>
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Profile
