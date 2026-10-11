import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import type { Role } from '../api'

export interface ChatMessage {
  seq?: number
  role: Role
  content: string
  model?: string | null
}

interface ChatWindowProps {
  messages: ChatMessage[]
  loading: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onCreateNote: (content: string) => Promise<boolean>
}

export default function ChatWindow({ messages, loading, draft, onDraftChange, onSend, onCreateNote}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // Keep the latest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!loading && draft.trim()) onSend()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit(event)
    }
  }

  async function handleNoteSubmit(event: FormEvent) {
    event.preventDefault()
    const content = noteDraft.trim()

    if (!content || savingNote || loading) return

    setSavingNote(true)
    try {
      const saved = await onCreateNote(content)
      if (saved) {
        setNoteDraft('')
        setShowNoteForm(false)
      }
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <section className="chat">
      <div className="messages">
        {messages.length === 0 && !loading && (
          <p className="muted center">Pose ta première question à Study Buddy.</p>
        )}
        {messages.map((m, i) => {
          if (m.role === 'note') {
            return (
              <div key={m.seq ?? i} className="chat-note">
                <strong>Ma note personnelle</strong>
                <p>{m.content}</p>
              </div>
            )
          }

          if (m.role === 'system-notification') {
            return (
              <div key={m.seq ?? i} className="system-notification">
                {m.content}
              </div>
            )
          }

          return (
            <div
              key={m.seq ?? i}
              className={`chat-message ${m.role}`}
            >
              <Markdown>{m.content}</Markdown>

              {m.role === 'assistant' && m.model && (
                <div className="message-model">
                  Modèle : {m.model}
                </div>
              )}
            </div>
          )
        })}

        {loading && <div className="bubble assistant typing">…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="note-actions">
        <button
          type="button"
          className="note-toggle"
          onClick={() => setShowNoteForm((visible) => !visible)}
          disabled={loading || savingNote}
        >
          {showNoteForm ? 'Annuler' : 'Ajouter une note'}
        </button>
      </div>

      {showNoteForm && (
        <form className="note-form" onSubmit={handleNoteSubmit}>
          <label htmlFor="note-content">Ta note personnelle</label>
          <textarea
            id="note-content"
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Écris une notion à retenir, un rappel..."
            rows={3}
            disabled={savingNote || loading}
          />
          <button
            type="submit"
            disabled={savingNote || loading || !noteDraft.trim()}
          >
            {savingNote ? 'Enregistrement…' : 'Enregistrer la note'}
          </button>
        </form>
      )}

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Écris ton message…"
          rows={2}
          disabled={loading}
          autoFocus
        />
        <button type="submit" disabled={loading || !draft.trim()}>
          Envoyer
        </button>
      </form>
    </section>
  )
}