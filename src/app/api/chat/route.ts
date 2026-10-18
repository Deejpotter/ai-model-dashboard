import { getModel } from '@/lib/db';

export const runtime = 'nodejs';

type Message = { role: 'user' | 'assistant'; content: string };

function textFrom(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => typeof part === 'object' && part && 'text' in part ? String(part.text ?? '') : '').join('');
  return '';
}

async function compatibleChat(baseUrl: string, apiKey: string, model: string, messages: Message[], extraHeaders: Record<string, string> = {}) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ model, messages, max_tokens: 512, temperature: 0.2 }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error?.message === 'string' ? data.error.message : `Provider returned ${response.status}.`);
  const content = textFrom(data.choices?.[0]?.message?.content);
  if (!content) throw new Error('The provider returned no chat content.');
  return content;
}

export async function POST(request: Request) {
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const body = await request.json() as { modelId?: number; messages?: Message[]; sessionId?: string };
    const modelId = typeof body.modelId === 'number' && Number.isInteger(body.modelId) ? body.modelId : undefined;
    const model = modelId == null ? undefined : getModel(modelId);
    const messages = Array.isArray(body.messages) ? body.messages.filter((m): m is Message => Boolean(m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')).slice(-12) : [];
    if (!model) return Response.json({ error: 'Model not found.' }, { status: 404 });
    if (!messages.length) return Response.json({ error: 'Send a message first.' }, { status: 400 });

    const via = new Set((model.available_via ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    let content: string;
    if ((model.model_id.startsWith('openrouter/') || via.has('openrouter')) && process.env.OPENROUTER_API_KEY) {
      content = await compatibleChat('https://openrouter.ai/api/v1/chat/completions', process.env.OPENROUTER_API_KEY, model.model_id.replace(/^openrouter\//, ''), messages);
    } else if (model.provider === 'OpenCode Zen' && process.env.OPENCODE_API_KEY) {
      content = await compatibleChat('https://opencode.ai/zen/v1/chat/completions', process.env.OPENCODE_API_KEY, model.model_id.replace(/^opencode\//, ''), messages);
    } else if (model.provider === 'OpenCode Go' && process.env.OPENCODE_API_KEY) {
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.length >= 8 && body.sessionId.length <= 200 ? body.sessionId : crypto.randomUUID();
      content = await compatibleChat('https://opencode.ai/zen/go/v1/chat/completions', process.env.OPENCODE_API_KEY, model.model_id.replace(/^opencode-go\//, ''), messages, {
        'user-agent': 'ai-model-dashboard/1.0',
        'x-opencode-session': sessionId,
      });
    } else if (model.provider === 'Anthropic' && process.env.ANTHROPIC_API_KEY) {
      const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: model.model_id.replace(/^anthropic\//, ''), max_tokens: 512, messages }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error?.message === 'string' ? data.error.message : `Provider returned ${response.status}.`);
      content = textFrom(data.content);
    } else if (model.provider === 'Google' && geminiApiKey) {
      const modelName = model.model_id.replace(/^google\//, '');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: messages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })), generationConfig: { maxOutputTokens: 512, temperature: 0.2 } }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error?.message === 'string' ? data.error.message : `Provider returned ${response.status}.`);
      content = textFrom(data.candidates?.[0]?.content?.parts);
      if (!content) throw new Error('The provider returned no chat content.');
    } else {
      const routes: Record<string, { key: string; url: string; prefix: RegExp }> = {
        OpenAI: { key: 'OPENAI_API_KEY', url: 'https://api.openai.com/v1/chat/completions', prefix: /^openai\// },
        DeepSeek: { key: 'DEEPSEEK_API_KEY', url: 'https://api.deepseek.com/chat/completions', prefix: /^deepseek\// },
        Mistral: { key: 'MISTRAL_API_KEY', url: 'https://api.mistral.ai/v1/chat/completions', prefix: /^mistral\// },
        xAI: { key: 'XAI_API_KEY', url: 'https://api.x.ai/v1/chat/completions', prefix: /^xai\// },
      };
      const route = routes[model.provider];
      const apiKey = route ? process.env[route.key] : undefined;
      if (!route || !apiKey) return Response.json({ error: `No server-side chat key is configured for ${model.name}. Add OPENROUTER_API_KEY, or this provider's key, then try again.`, setupRequired: true }, { status: 422 });
      content = await compatibleChat(route.url, apiKey, model.model_id.replace(route.prefix, ''), messages);
    }
    return Response.json({ content, model: model.name });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Chat request failed.' }, { status: 502 });
  }
}
