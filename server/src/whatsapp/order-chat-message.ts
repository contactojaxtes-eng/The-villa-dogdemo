const DRIVER_CHAT_MEDIA_TYPES = new Set(['image', 'audio', 'video', 'document', 'sticker']);

function publicReplyContent(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('|')) {
    const caption = raw.split('|').slice(1).join('|').trim();
    if (caption) return caption;
  }
  if (raw.includes('/api/whatsapp/media/') || /^[A-Za-z0-9._-]{20,256}$/.test(raw)) {
    return 'Archivo multimedia';
  }
  return raw;
}

export type DriverOrderChatMessage = {
  id: string;
  direction: string;
  content: string;
  messageType: string;
  status: string;
  createdAt: Date | string;
  replyToContent: string | null;
  replyToDirection: string | null;
  hasMedia: boolean;
};

export function toDriverOrderChatMessage(message: any): DriverOrderChatMessage {
  const messageType = String(message?.messageType || 'text').toLowerCase();
  const hasMedia = DRIVER_CHAT_MEDIA_TYPES.has(messageType);
  const rawContent = String(message?.content || '');
  const publicContent = hasMedia && rawContent.includes('|')
    ? rawContent.split('|').slice(1).join('|').trim()
    : hasMedia
      ? ''
      : rawContent;

  return {
    id: String(message?.id || ''),
    direction: String(message?.direction || ''),
    content: publicContent,
    messageType,
    status: String(message?.status || ''),
    createdAt: message?.createdAt,
    replyToContent: publicReplyContent(message?.replyToContent),
    replyToDirection: message?.replyToDirection || null,
    hasMedia,
  };
}

export function extractDriverChatMediaId(message: any): string | null {
  const messageType = String(message?.messageType || '').toLowerCase();
  if (!DRIVER_CHAT_MEDIA_TYPES.has(messageType)) return null;

  const raw = String(message?.content || '').split('|')[0].trim();
  const mediaId = raw.includes('/') ? (raw.split('/').pop() || '') : raw;
  if (!/^[A-Za-z0-9._-]{1,256}$/.test(mediaId)) return null;
  return mediaId;
}
