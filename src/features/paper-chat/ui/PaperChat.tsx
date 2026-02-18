import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { MessageCircle, Send, Trash2, AlertCircle, Bot, User, Sparkles } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { Textarea } from '@/shared/ui/Textarea';
import { usePaperChat } from '@/features/paper-chat/model/usePaperChat';
import {
  Dialog,
  DialogContent,
} from '@/shared/ui/Dialog';

interface PaperChatProps {
  reportId: string;
  mode?: 'inline' | 'modal';
  defaultOpen?: boolean;
  starters?: string[];
}

const DEFAULT_STARTERS = [
  'Summarize the main findings in 5 bullets with references.',
  'Which studies were randomized controlled trials?',
  'What evidence conflicts across studies?',
];

function trackReportEvent(name: string, payload: Record<string, unknown> = {}) {
  const eventPayload = { name, payload, ts: Date.now() };
  window.dispatchEvent(new CustomEvent('report-ui-event', { detail: eventPayload }));
  if (import.meta.env.DEV) {
    console.debug('[report-ui-event]', eventPayload);
  }
}

function getAutoOpenKey(reportId: string): string {
  return `paper-chat:auto-opened:${reportId}`;
}

interface ChatPanelProps {
  reportId: string;
  starters: string[];
  className?: string;
}

function ChatPanel({ reportId, starters, className }: ChatPanelProps) {
  const { messages, isStreaming, error, sendMessage, clearChat, retryLast } = usePaperChat(reportId);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleStarter = (starter: string) => {
    if (isStreaming) return;
    sendMessage(starter);
  };

  return (
    <div className={`rounded-lg border border-border bg-card overflow-hidden ${className || ''}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Chat with Papers</h3>
          <span className="text-xs text-muted-foreground">Evidence-grounded answers with inline refs</span>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="h-7 text-xs text-muted-foreground hover:text-foreground">
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      <div className="h-[min(52vh,420px)] overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm font-medium">Ask anything about these studies</p>
            <p className="text-xs mt-1">Prefer specific prompts for better citation grounding.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 max-w-xl">
              {starters.map((starter) => (
                <Button
                  key={starter}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto whitespace-normal text-left"
                  onClick={() => handleStarter(starter)}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  <span className="text-xs">{starter}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[82%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground whitespace-pre-wrap'
                  : 'bg-muted text-foreground prose prose-sm prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'
              }`}
            >
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              )}
              {msg.role === 'assistant' && isStreaming && i === messages.length - 1 && (
                <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse motion-reduce:animate-none ml-0.5 align-text-bottom" />
              )}
            </div>
            {msg.role === 'user' && (
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center mt-0.5">
                <User className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs text-destructive bg-destructive/10 border-t border-border">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={retryLast}>
            Retry
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3 border-t border-border bg-background">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about methods, outcomes, or conflicting evidence..."
          className="min-h-[40px] max-h-[120px] resize-none text-sm"
          rows={1}
          disabled={isStreaming}
        />
        <Button type="submit" size="sm" disabled={!input.trim() || isStreaming} className="h-10 px-3">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

export function PaperChat({
  reportId,
  mode = 'inline',
  defaultOpen = false,
  starters = DEFAULT_STARTERS,
}: PaperChatProps) {
  const [open, setOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (mode !== 'modal' || !defaultOpen) return;
    const key = getAutoOpenKey(reportId);
    const hasAutoOpened = localStorage.getItem(key) === '1';
    if (!hasAutoOpened) {
      setOpen(true);
      localStorage.setItem(key, '1');
      trackReportEvent('chat_open', { source: 'auto_open_once', reportId });
    }
  }, [mode, defaultOpen, reportId]);

  if (mode === 'inline') {
    return <ChatPanel reportId={reportId} starters={starters} />;
  }

  return (
    <>
      <Button
        ref={openButtonRef}
        type="button"
        size="sm"
        className="fixed bottom-5 right-5 z-30 rounded-full px-4 shadow-lg"
        onClick={() => {
          setOpen(true);
          trackReportEvent('chat_open', { source: 'floating_button', reportId });
        }}
        aria-label="Open paper chat"
      >
        <MessageCircle className="h-4 w-4" />
        Ask Papers
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="w-[min(94vw,820px)] max-w-none h-[78vh] p-0 gap-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            openButtonRef.current?.focus();
          }}
        >
          <div className="flex-1 min-h-0 p-4">
            <ChatPanel reportId={reportId} starters={starters} className="h-full" />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
