// Thin typed wrappers around the FastAPI backend (proxied under /api by Vite).

export type Role =
  | 'user'
  | 'assistant'
  | 'system-notification'
  | 'note'
  
export interface ConversationSummary {
  id: number
  created_at: string
  preview: string | null
}

export interface Message {
  seq: number
  role: Role
  content: string
  model?: string | null
  created_at: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onNotification: (content: string) => void
}

export interface ModelsResponse {
  models: string[];
  default: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Impossible de joindre le serveur.')
  }
  if (!response.ok) {
    // FastAPI errors look like {"detail": "..."}.
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : null
    throw new Error(detail ?? `Erreur ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request('/conversations')
}

export async function createConversation(): Promise<number> {
  const { conversation_id } = await request<{ conversation_id: number }>('/conversations', {
    method: 'POST',
  })
  return conversation_id
}

export function getMessages(conversationId: number): Promise<Message[]> {
  return request(`/conversations/${conversationId}/messages`)
}

export interface ChatResult {
  reply: string
  notification: string | null // set when the backend also stored a system-notification
}

export function sendMessage(conversationId: number, message: string): Promise<ChatResult> {
  return request('/chat', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, message }),
  })
}

export function createNote(conversationId: number, content: string): Promise<Message> {
  return request(`/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export async function sendMessageStream(
  conversationId: number,
  message: string,
  model: string,
  callbacks: StreamCallbacks,
): Promise<string> {
  let response: Response

  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: conversationId,
        message,
        model,
      }),
    })
  } catch {
    throw new Error('Impossible de joindre le serveur.')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail =
      typeof body?.detail === 'string' ? body.detail : null

    throw new Error(detail ?? `Erreur ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Le navigateur ne peut pas lire le flux.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let reply = ''
  let completed = false

  function processFrame(frame: string) {
    const dataLines = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())

    if (dataLines.length === 0) return

    const data = dataLines.join('\n')

    if (data === '[DONE]') {
      completed = true
      return
    }

    let payload: {
      type?: string
      content?: string
      message?: string
    }

    try {
      payload = JSON.parse(data)
    } catch {
      throw new Error('Le serveur a renvoyé un événement invalide.')
    }

    if (payload.type === 'error') {
      throw new Error(
        payload.message ?? 'La génération a échoué.',
      )
    }

    if (
      payload.type === 'token' &&
      typeof payload.content === 'string'
    ) {
      reply += payload.content
      callbacks.onToken(payload.content)
    }

    if (
      payload.type === 'notification' &&
      typeof payload.content === 'string'
    ) {
      callbacks.onNotification(payload.content)
    }
  }

  try {
    while (!completed) {
      const { value, done } = await reader.read()

      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        processFrame(frame)
        if (completed) break
      }
    }

    if (!completed) {
      buffer += decoder.decode()
      if (buffer.trim()) processFrame(buffer)

      if (!completed) {
        throw new Error(
          'Le flux a été interrompu avant la fin de la réponse.',
        )
      }
    }

    return reply
  } finally {
    reader.releaseLock()
  }
}

export async function getModels(): Promise<ModelsResponse> {
  return request<ModelsResponse>('/models');
}