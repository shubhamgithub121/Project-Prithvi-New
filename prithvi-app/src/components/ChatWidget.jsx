import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MessageCircle, X, Send, ThumbsUp, ThumbsDown, RotateCcw, Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { apiGet, apiPost, apiStream } from '../lib/apiClient'
import logo from '../assets/logo.png'
import './ChatWidget.css'

const HIDDEN_ON = ['/login', '/signup', '/auth/callback']
const SESSION_KEY = 'prithviChatSession'
const MAX_CHARS = 500

const storage = {
  get: () => { try { return localStorage.getItem(SESSION_KEY) } catch { return null } },
  set: (v) => { try { v ? localStorage.setItem(SESSION_KEY, v) : localStorage.removeItem(SESSION_KEY) } catch { /* private mode */ } },
}

let nextId = 0
const localId = () => `m${++nextId}`

// --- Minimal markdown: paragraphs, - / 1. lists, **bold**, [links](...) ---

function Inline({ text, onNavigate }) {
  const parts = []
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1]) parts.push(<strong key={m.index}>{m[1]}</strong>)
    else if (m[3].startsWith('/')) parts.push(<Link key={m.index} to={m[3]} onClick={onNavigate}>{m[2]}</Link>)
    else if (/^https?:\/\//.test(m[3])) parts.push(<a key={m.index} href={m[3]} target="_blank" rel="noopener noreferrer">{m[2]}</a>)
    else parts.push(m[2])
    last = re.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function Markdown({ text, onNavigate }) {
  const blocks = []
  let list = null
  text.split('\n').forEach((line, i) => {
    const item = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)$/)
    if (item) {
      const ordered = Boolean(item[1])
      if (!list || list.ordered !== ordered) blocks.push((list = { ordered, items: [] }))
      list.items.push(item[2])
      return
    }
    list = null
    if (line.trim()) blocks.push({ p: line, key: i })
  })
  return blocks.map((b, i) => {
    if (b.items) {
      const Tag = b.ordered ? 'ol' : 'ul'
      return <Tag key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} onNavigate={onNavigate} /></li>)}</Tag>
    }
    return <p key={i}><Inline text={b.p} onNavigate={onNavigate} /></p>
  })
}

// --- Rich cards ---

function PickupCard({ p }) {
  const date = new Date(`${p.pickup_date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <div className="cw-pickup">
      <div className="cw-pickup-top">
        <strong>{date}</strong>
        <span className={`cw-badge cw-badge-${p.status}`}>{p.status}</span>
      </div>
      <div className="cw-pickup-meta">{p.time_slot}{p.city ? ` · ${p.city}` : ''}</div>
      <div className="cw-pickup-meta">{p.estimated_weight_kg} kg · ₹{p.estimated_earnings}</div>
    </div>
  )
}

function ConfirmCancel({ confirm, onConfirm }) {
  if (confirm.state === 'done') return <div className="cw-note">Pickup cancelled.</div>
  if (confirm.state === 'kept') return <div className="cw-note">Okay, your pickup stays booked.</div>
  return (
    <div className="cw-confirm">
      <PickupCard p={confirm.pickup} />
      {confirm.error && <div className="cw-error">{confirm.error}</div>}
      <div className="cw-confirm-actions">
        <button className="cw-btn cw-btn-danger" disabled={confirm.state === 'working'} onClick={() => onConfirm(true)}>
          {confirm.state === 'working' ? 'Cancelling…' : 'Yes, cancel'}
        </button>
        <button className="cw-btn" disabled={confirm.state === 'working'} onClick={() => onConfirm(false)}>Keep it</button>
      </div>
    </div>
  )
}

export default function ChatWidget() {
  const { user, isAuthenticated } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [flows, setFlows] = useState([])
  const [showMore, setShowMore] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState(storage.get)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const panelRef = useRef(null)
  const wasAuthed = useRef(isAuthenticated)

  const firstName = (user?.user_metadata?.full_name || user?.user_metadata?.name || '').split(' ')[0]

  useEffect(() => {
    apiGet('/api/chat/flows').then(setFlows).catch(() => setFlows([]))
  }, [])

  // Restore the previous conversation once, the first time the panel opens. Sessions created
  // after that (the first message of a new chat) must not trigger a restore mid-stream.
  const restored = useRef(false)
  useEffect(() => {
    if (!open || restored.current) return
    restored.current = true
    if (!sessionId) return
    apiGet(`/api/chat/history?session_id=${sessionId}`)
      .then((rows) => setMessages((ms) => (ms.length ? ms // user already started typing; don't clobber the live exchange
        : rows.map((r) => ({ id: localId(), role: r.role, text: r.content, messageId: r.id, feedback: r.feedback })))))
      .catch(() => { storage.set(null); setSessionId(null) })
  }, [open, sessionId])

  // Signing out starts a fresh chat so the next person on this device can't see it.
  useEffect(() => {
    if (wasAuthed.current && !isAuthenticated) resetChat()
    wasAuthed.current = isAuthenticated
  }, [isAuthenticated])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const resetChat = () => {
    storage.set(null)
    setSessionId(null)
    setMessages([])
    setShowMore(false)
  }

  const patchMessage = (id, fn) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)))

  const send = async (payload, label) => {
    if (busy) return
    const botId = localId()
    setMessages((ms) => [
      ...ms,
      { id: localId(), role: 'user', text: label },
      { id: botId, role: 'assistant', text: '', status: 'Thinking…', streaming: true },
    ])
    setBusy(true)
    try {
      await apiStream('/api/chat', { ...payload, session_id: sessionId }, (ev) => {
        if (ev.type === 'session') { setSessionId(ev.session_id); storage.set(ev.session_id) }
        else if (ev.type === 'text') patchMessage(botId, (m) => ({ text: m.text + ev.text, status: null }))
        else if (ev.type === 'replace') patchMessage(botId, () => ({ text: ev.text, status: null }))
        else if (ev.type === 'status') patchMessage(botId, () => ({ status: ev.text }))
        else if (ev.type === 'pickups') patchMessage(botId, () => ({ pickups: ev.pickups }))
        else if (ev.type === 'confirm_cancel') patchMessage(botId, () => ({ confirm: { pickup: ev.pickup, state: 'pending' } }))
        else if (ev.type === 'done') patchMessage(botId, () => ({ messageId: ev.message_id }))
      })
    } catch (e) {
      patchMessage(botId, (m) => ({ text: m.text || e.message || 'Something went wrong. Please try again.', error: !m.text }))
    } finally {
      patchMessage(botId, () => ({ streaming: false, status: null }))
      setBusy(false)
    }
  }

  const submit = (e) => {
    e.preventDefault()
    const text = input.trim()
    if (!text) return
    setInput('')
    send({ message: text }, text)
  }

  const confirmCancel = async (msg, yes) => {
    if (!yes) return patchMessage(msg.id, (m) => ({ confirm: { ...m.confirm, state: 'kept' } }))
    patchMessage(msg.id, (m) => ({ confirm: { ...m.confirm, state: 'working', error: null } }))
    try {
      await apiPost(`/api/pickups/${msg.confirm.pickup.id}/cancel`)
      patchMessage(msg.id, (m) => ({ confirm: { ...m.confirm, state: 'done' } }))
    } catch {
      const error = "Couldn't cancel this pickup. Please make sure you're signed in and try again."
      patchMessage(msg.id, (m) => ({ confirm: { ...m.confirm, state: 'pending', error } }))
    }
  }

  const rate = (msg, rating) => {
    if (!msg.messageId || msg.feedback) return
    patchMessage(msg.id, () => ({ feedback: rating }))
    apiPost('/api/chat/feedback', { session_id: sessionId, message_id: msg.messageId, rating }).catch(() => {})
  }

  // Esc closes; Tab stays inside the panel.
  const onKeyDown = (e) => {
    if (e.key === 'Escape') return setOpen(false)
    if (e.key !== 'Tab') return
    const focusable = panelRef.current.querySelectorAll('button:not(:disabled), a[href], textarea, input')
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  if (HIDDEN_ON.includes(location.pathname)) return null

  const closeOnMobile = () => { if (window.matchMedia('(max-width: 639px)').matches) setOpen(false) }
  const chips = flows.filter((f) => f.primary || showMore)
  const human = flows.find((f) => f.id === 'human')

  return (
    <div className="cw-root">
      {open && (
        <div className="cw-panel" role="dialog" aria-label="Prithvi Assistant" ref={panelRef} onKeyDown={onKeyDown}>
          <header className="cw-header">
            <img src={logo} alt="" className="cw-logo" />
            <div className="cw-title">
              <strong>Prithvi Assistant</strong>
              <span><i className="cw-dot" /> Online</span>
            </div>
            {messages.length > 0 && (
              <button className="cw-icon-btn" onClick={resetChat} aria-label="New chat" title="New chat" disabled={busy}>
                <RotateCcw size={18} />
              </button>
            )}
            <button className="cw-icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">
              <X size={20} />
            </button>
          </header>

          <div className="cw-messages" ref={listRef} aria-live="polite">
            <div className="cw-msg cw-bot">
              <div className="cw-bubble">
                <p>Hi{firstName ? ` ${firstName}` : ''}! I'm the Prithvi Assistant. Ask me about pickups, recycling, earnings or rewards — in English or Hindi.</p>
              </div>
            </div>
            {messages.length === 0 && (
              <div className="cw-chips">
                {chips.map((f) => (
                  <button key={f.id} className="cw-chip" disabled={busy} onClick={() => send({ flow: f.id }, f.label)}>{f.label}</button>
                ))}
                {!showMore && flows.some((f) => !f.primary) && (
                  <button className="cw-chip cw-chip-ghost" onClick={() => setShowMore(true)}>More…</button>
                )}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`cw-msg ${m.role === 'user' ? 'cw-user' : 'cw-bot'}`}>
                <div className={`cw-bubble${m.error ? ' cw-bubble-error' : ''}`}>
                  {m.role === 'user' ? <p>{m.text}</p> : <Markdown text={m.text} onNavigate={closeOnMobile} />}
                  {m.status && <div className="cw-status"><Loader2 size={14} className="cw-spin" /> {m.status}</div>}
                  {m.pickups?.length > 0 && <div className="cw-cards">{m.pickups.map((p) => <PickupCard key={p.id} p={p} />)}</div>}
                  {m.confirm && <ConfirmCancel confirm={m.confirm} onConfirm={(yes) => confirmCancel(m, yes)} />}
                </div>
                {m.role === 'assistant' && !m.streaming && m.messageId && (
                  <div className="cw-feedback">
                    <button aria-label="Helpful" className={m.feedback === 'up' ? 'cw-on' : ''} disabled={Boolean(m.feedback)} onClick={() => rate(m, 'up')}><ThumbsUp size={14} /></button>
                    <button aria-label="Not helpful" className={m.feedback === 'down' ? 'cw-on' : ''} disabled={Boolean(m.feedback)} onClick={() => rate(m, 'down')}><ThumbsDown size={14} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <form className="cw-input" onSubmit={submit}>
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_CHARS}
              placeholder="Type your question…"
              aria-label="Message"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e) }}
            />
            <button type="submit" className="cw-send" disabled={busy || !input.trim()} aria-label="Send">
              <Send size={18} />
            </button>
          </form>
          {human && (
            <button className="cw-human" disabled={busy} onClick={() => send({ flow: human.id }, human.label)}>Talk to a human</button>
          )}
        </div>
      )}

      <button
        className={`cw-launcher${open ? ' cw-launcher-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        aria-expanded={open}
      >
        {open ? <X size={26} /> : <MessageCircle size={26} />}
        {!open && messages.length === 0 && <span className="cw-unread" />}
      </button>
    </div>
  )
}
