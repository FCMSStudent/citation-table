import { useState, useCallback, useEffect } from 'react';
import { getSupabase } from '@/integrations/supabase/fallback';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function getChatStorageKey(reportId: string): string {
  return `paper-chat:${reportId}`;
}

function parseStoredMessages(raw: string | null): ChatMessage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ChatMessage => {
        return !!item &&
          typeof item === 'object' &&
          ('role' in item) &&
          ('content' in item) &&
          ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant') &&
          typeof (item as ChatMessage).content === 'string';
      })
      .map((item) => ({
        role: item.role,
        content: item.content,
      }));
  } catch {
    return [];
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const CHAT_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/chat-papers` : '';

export function usePaperChat(reportId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) {
      setMessages([]);
      return;
    }
    const key = getChatStorageKey(reportId);
    setMessages(parseStoredMessages(localStorage.getItem(key)));
  }, [reportId]);

  useEffect(() => {
    if (!reportId) return;
    const key = getChatStorageKey(reportId);
    localStorage.setItem(key, JSON.stringify(messages));
  }, [messages, reportId]);

  const sendMessage = useCallback(async (input: string) => {
    if (!reportId || !input.trim() || isStreaming) return;

    setError(null);
    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setIsStreaming(true);

    let assistantSoFar = '';
    let lastFlushAt = 0;
    const FLUSH_INTERVAL_MS = 80;
    const flushAssistantSnapshot = (force = false) => {
      const now = Date.now();
      if (!force && now - lastFlushAt < FLUSH_INTERVAL_MS) return;
      lastFlushAt = now;
      const snapshot = assistantSoFar;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: snapshot } : m);
        }
        return [...prev, { role: 'assistant', content: snapshot }];
      });
    };

    try {
      if (!CHAT_URL) {
        throw new Error('Supabase URL is not configured');
      }

      // Get the user's session access token
      const client = getSupabase();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) {
        setError('Please sign in to use chat');
        setIsStreaming(false);
        return;
      }

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          report_id: reportId,
          messages: updatedMessages,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errBody.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error('No response body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              flushAssistantSnapshot();
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantSoFar += content;
              flushAssistantSnapshot();
            }
          } catch { /* ignore partial */ }
        }
      }
      flushAssistantSnapshot(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
    } finally {
      setIsStreaming(false);
    }
  }, [reportId, messages, isStreaming]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setError(null);
    if (reportId) {
      localStorage.removeItem(getChatStorageKey(reportId));
    }
  }, [reportId]);

  const retryLast = useCallback(() => {
    if (isStreaming) return;
    const lastUser = [...messages].reverse().find((msg) => msg.role === 'user');
    if (!lastUser) return;
    void sendMessage(lastUser.content);
  }, [messages, isStreaming, sendMessage]);

  return { messages, isStreaming, error, sendMessage, clearChat, retryLast };
}
