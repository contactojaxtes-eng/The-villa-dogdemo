CREATE INDEX IF NOT EXISTS "whatsapp_sessions_active_lastMessageAt_idx"
ON "whatsapp_sessions"("active", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "whatsapp_sessions_active_assignedToId_lastMessageAt_idx"
ON "whatsapp_sessions"("active", "assignedToId", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "whatsapp_messages_sessionId_createdAt_idx"
ON "whatsapp_messages"("sessionId", "createdAt");

CREATE INDEX IF NOT EXISTS "whatsapp_messages_direction_status_createdAt_idx"
ON "whatsapp_messages"("direction", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "orders_orderType_createdAt_idx"
ON "orders"("orderType", "createdAt");

CREATE INDEX IF NOT EXISTS "orders_orderType_status_createdAt_idx"
ON "orders"("orderType", "status", "createdAt");
