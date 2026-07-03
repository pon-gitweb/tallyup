import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { auth } from '../firebase'
import styles from './SuiteePage.module.css'

// ─── Constants ────────────────────────────────────────────────────────────────

const AI_BASE = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api'

const FESTIVAL_QUESTIONS = [
  'What did we sell most of at this event and which bar performed best?',
  'Were we over or under-stocked on spirits based on actuals vs prediction?',
  'Which supplier had the most accurate delivery against our purchase order?',
  'What should we order more of next year based on what ran out?',
  'How did our actual spend compare to the event budget?',
  'Which bar had the highest depletion rate during the event?',
]

const VENUE_QUESTIONS = [
  'What were my top 3 variance drivers last stocktake and what likely caused them?',
  'How does my Hosti Health score compare to the NZ hospitality benchmark?',
  'Which of my recipes has the worst GP% and what should I price it at?',
  'Which products should I reorder this week based on current stock levels?',
  'Which supplier has increased their prices the most in the last 3 months?',
  'I can see my variance report — which products should I investigate first?',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = { role: 'user' | 'suitee'; text: string }

// ─── Markdown-lite renderer ───────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part,
  )
}

function renderAnswer(text: string): React.ReactNode {
  const lines = text.split('\n')
  const result: React.ReactNode[] = []
  let listItems: string[] = []
  let key = 0

  const flushList = () => {
    if (listItems.length === 0) return
    result.push(
      <ul key={key++}>
        {listItems.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </ul>,
    )
    listItems = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^[-*]\s+/.test(line)) {
      listItems.push(line.replace(/^[-*]\s+/, ''))
    } else {
      flushList()
      if (line.trim() === '') {
        if (i < lines.length - 1) result.push(<br key={key++} />)
      } else {
        result.push(
          <span key={key++}>
            {renderInline(line)}
            {i < lines.length - 1 && <br />}
          </span>,
        )
      }
    }
  }
  flushList()
  return <>{result}</>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SuiteePage({ venueId, isFestival = false }: { venueId: string; user: User; isFestival?: boolean }) {
  const SUGGESTED_QUESTIONS = isFestival ? FESTIVAL_QUESTIONS : VENUE_QUESTIONS
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [usageWarning, setUsageWarning] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [copied, setCopied] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Textarea auto-grow
  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────────

  async function sendMessage() {
    const question = input.trim()
    if (!question || loading) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const userMsg: Message = { role: 'user', text: question }
    const history = messages.map((m) => ({ role: m.role, text: m.text }))
    const next = [...messages, userMsg]
    setMessages(next)
    setLoading(true)
    setConfirmClear(false)

    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null)
      const res = await fetch(`${AI_BASE}/suitee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ question, venueId, history }),
      })
      const data = await res.json().catch(() => ({ ok: false }))
      if (data.ok && data.answer) {
        setMessages([...next, { role: 'suitee', text: data.answer }])
        if (data.usageWarning) setUsageWarning(data.usageWarning)
      } else {
        setMessages([
          ...next,
          { role: 'suitee', text: "I'm having trouble accessing your data right now. Please try again." },
        ])
      }
    } catch {
      setMessages([
        ...next,
        { role: 'suitee', text: "I'm having trouble accessing your data right now. Please try again." },
      ])
    } finally {
      setLoading(false)
    }
  }

  // ── Sidebar actions ──────────────────────────────────────────────────────────

  function useChip(question: string) {
    setInput(question)
    textareaRef.current?.focus()
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }

  function clearConversation() {
    setMessages([])
    setUsageWarning(null)
    setConfirmClear(false)
  }

  async function copyLastResponse() {
    const last = [...messages].reverse().find((m) => m.role === 'suitee')
    if (!last) return
    await navigator.clipboard.writeText(last.text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function exportConversation() {
    const dateStr = new Date().toISOString().slice(0, 10)
    const text = messages
      .map((m) => `${m.role === 'user' ? 'You' : 'Suitee'}: ${m.text}`)
      .join('\n\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `suitee-conversation-${dateStr}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const lastSuiteeMsg = [...messages].reverse().find((m) => m.role === 'suitee')
  const hasMessages = messages.length > 0

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>

      {/* ── LEFT: Chat ── */}
      <div className={styles.chatCol}>
        <div className={styles.chatHeader}>
          <h1 className={styles.chatHeading}>✦ Suitee</h1>
          <p className={styles.chatSubhead}>
            Your venue intelligence assistant — ask anything about your data.
          </p>
        </div>

        {/* Thread */}
        <div className={styles.thread}>
          {!hasMessages && !loading ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyLogo}>H</div>
              <p className={styles.emptyText}>
                Ask Suitee anything about your venue — variance, pricing, stock, recipes,
                suppliers, or how to improve your score. Suitee only uses your venue's real data.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`${styles.msgRow} ${msg.role === 'user' ? styles.msgRowUser : styles.msgRowSuitee}`}
                >
                  <div
                    className={`${styles.bubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleSuitee}`}
                  >
                    {msg.role === 'user' ? msg.text : renderAnswer(msg.text)}
                  </div>
                </div>
              ))}
              {loading && (
                <div className={styles.thinkingRow}>
                  <span className={styles.thinkingLabel}>Suitee is thinking</span>
                  <div className={styles.dots}>
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                    <div className={styles.dot} />
                  </div>
                </div>
              )}
              <div ref={threadEndRef} />
            </>
          )}
        </div>

        {/* Usage warning */}
        {usageWarning && (
          <div className={styles.usageWarning} onClick={() => setUsageWarning(null)}>
            {usageWarning}
          </div>
        )}

        {/* Input area */}
        <div className={styles.inputArea}>
          <div className={styles.inputRow}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              rows={1}
              placeholder="Ask about your venue data…"
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              type="button"
              className={styles.sendBtn}
              onClick={sendMessage}
              disabled={!input.trim() || loading}
            >
              Send
            </button>
          </div>
          <p className={styles.poweredBy}>Powered by Claude</p>
        </div>
      </div>

      {/* ── RIGHT: Sidebar ── */}
      <div className={styles.sidebarCol}>

        {/* Suggested questions */}
        <div className={styles.sidebarSection}>
          <p className={styles.sidebarHeading}>Suggested questions</p>
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className={styles.chip}
              onClick={() => useChip(q)}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Conversation tools */}
        <div className={styles.sidebarSection}>
          <p className={styles.sidebarHeading}>Conversation</p>

          {confirmClear ? (
            <div className={styles.confirmInline}>
              <span className={styles.confirmInlineText}>Clear all messages?</span>
              <button type="button" className={styles.confirmYes} onClick={clearConversation}>
                Clear
              </button>
              <button type="button" className={styles.confirmNo} onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.toolBtn} ${styles.toolBtnDanger}`}
              disabled={!hasMessages}
              onClick={() => setConfirmClear(true)}
            >
              Clear conversation
            </button>
          )}

          <button
            type="button"
            className={styles.toolBtn}
            disabled={!lastSuiteeMsg}
            onClick={copyLastResponse}
          >
            {copied ? '✓ Copied!' : 'Copy last response'}
          </button>

          <button
            type="button"
            className={styles.toolBtn}
            disabled={!hasMessages}
            onClick={exportConversation}
          >
            Export conversation
          </button>
        </div>
      </div>
    </div>
  )
}
