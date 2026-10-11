import { useEffect, useState } from 'react'
import './App.css'
import {
  createConversation,
  createNote,
  getMessages,
  listConversations,
  // sendMessage,
  sendMessageStream,
  type ConversationSummary,
} from './api'
import ChatWindow, { type ChatMessage } from './components/ChatWindow'
import Sidebar from './components/Sidebar'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Une erreur est survenue.'
}

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // On startup, load the history and open the most recent conversation.
  useEffect(() => {
    listConversations()
      .then((list) => {
        setConversations(list)
        if (list.length > 0) setActiveId(list[0].id)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // Load the messages whenever another conversation is opened.
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    getMessages(activeId)
      .then((list) => {
        if (!cancelled) setMessages(list.map(({ seq, role, content }) => ({ seq, role, content })))
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [activeId])

  function selectConversation(id: number) {
    if (loading || id === activeId) return
    setError(null)
    setDraft('')
    setMessages([])
    setActiveId(id)
  }

  async function handleNew() {
    if (loading) return
    setError(null)
    try {
      const id = await createConversation()
      setConversations((list) => [
        { id, created_at: new Date().toISOString(), preview: null },
        ...list,
      ])
      setDraft('')
      setMessages([])
      setActiveId(id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleSend() {
    if (activeId === null || loading) return

    const conversationId = activeId
    const text = draft.trim()

    if (!text) return

    const isFirstMessage = messages.length === 0

    setError(null)
    setDraft('')
    setLoading(true)

    setMessages((list) => [
      ...list,
      { role: 'user', content: text },
      { role: 'assistant', content: '' },
    ])

    try {
      await sendMessageStream(conversationId, text, {
        onToken: (token) => {
          setMessages((list) => {
            const updated = [...list]

            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === 'assistant') {
                updated[i] = {
                  ...updated[i],
                  content: updated[i].content + token,
                }
                break
              }
            }

            return updated
          })
        },

        onNotification: (content) => {
          setMessages((list) => [
            ...list,
            { role: 'system-notification', content },
          ])
        },
      })
      // The first message becomes the conversation's preview in the sidebar.
      if (isFirstMessage) setConversations(await listConversations())
    } catch (err) {
      setError(errorMessage(err))

      // Reload the current state from the database: the commit may have succeeded just before a network outage.
      try {
        const persisted = await getMessages(conversationId)

        setMessages(
          persisted.map(({ seq, role, content }) => ({
            seq,
            role,
            content,
          })),
        )

        let saved = false

        for (let i = persisted.length - 2; i >= 0; i--) {
          if (
            persisted[i].role === 'user' &&
            persisted[i].content === text &&
            persisted[i + 1].role === 'assistant'
          ) {
            saved = true
            break
          }
        }

        // Do not revert the text to a draft if it has been saved.
        if (!saved) setDraft(text)
      } catch {
        // If the reload fails, remove the two provisional bubbles.
        setMessages((list) => list.slice(0, -2))
        setDraft(text)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateNote(content: string): Promise<boolean> {
    if (activeId === null) return false

    setError(null)

    try {
      const note = await createNote(activeId, content)

      setMessages((list) => [
        ...list,
        {
          seq: note.seq,
          role: note.role,
          content: note.content,
        },
      ])

      return true
    } catch (err) {
      setError(errorMessage(err))
      return false
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={handleNew}
      />
      <main className="main">
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Fermer">
              ×
            </button>
          </div>
        )}
        {activeId === null ? (
          <div className="empty">
            <p>Aucune conversation ouverte.</p>
            <button className="new-button" onClick={handleNew}>
              + Nouvelle conversation
            </button>
          </div>
        ) : (
          <ChatWindow
            messages={messages}
            loading={loading}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSend}
            onCreateNote={handleCreateNote}
          />
        )}
      </main>
    </div>
  )
}
