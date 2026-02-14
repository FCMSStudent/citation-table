import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { MessageCircle, Send, Trash2, AlertCircle, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePaperChat } from '@/hooks/usePaperChat';

interface PaperChatProps {
  reportId: string;
}

export function PaperChat({ reportId }: PaperChatProps) {
  const { messages, isStreaming, error, sendMessage, clearChat } = usePaperChat(reportId);
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

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Chat with Papers</h3>
          <span className="text-xs text-muted-foreground">Ask questions about the studies</span>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearChat} className="h-7 text-xs text-muted-foreground hover:text-foreground">
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <div className="h-80 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm font-medium">Ask anything about your studies</p>
            <p className="text-xs mt-1">e.g. "Which studies used RCTs?" or "Summarize the key findings"</p>
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
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
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
                <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
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

      {/* Error */}
      {error && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs text-destructive bg-destructive/10 border-t border-border">
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2 p-3 border-t border-border bg-background">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the studies..."
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
