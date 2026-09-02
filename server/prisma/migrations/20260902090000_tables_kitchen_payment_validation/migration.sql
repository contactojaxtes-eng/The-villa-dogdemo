-- Mesas, cocina por estaciones y comprobantes temporales.

ALTER TABLE "orders"
  ADD COLUMN "tableId" TEXT,
  ADD COLUMN "kitchenStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
  ADD COLUMN "sentToKitchenAt" TIMESTAMP(3),
  ADD COLUMN "servedAt" TIMESTAMP(3),
  ADD COLUMN "clientMutationId" TEXT;

CREATE UNIQUE INDEX "orders_clientMutationId_key" ON "orders"("clientMutationId");
CREATE INDEX "orders_tableId_idx" ON "orders"("tableId");
CREATE INDEX "orders_kitchenStatus_idx" ON "orders"("kitchenStatus");

CREATE TABLE "dining_tables" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "openedById" TEXT NOT NULL,
  "cashRegisterId" TEXT,
  "cashClosingId" TEXT,
  CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dining_tables_status_idx" ON "dining_tables"("status");
CREATE INDEX "dining_tables_openedById_idx" ON "dining_tables"("openedById");
CREATE INDEX "dining_tables_cashRegisterId_idx" ON "dining_tables"("cashRegisterId");
CREATE INDEX "dining_tables_cashClosingId_idx" ON "dining_tables"("cashClosingId");

CREATE TABLE "kitchen_stations" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "color" TEXT DEFAULT '#F97316',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kitchen_stations_active_idx" ON "kitchen_stations"("active");

CREATE TABLE "kitchen_tickets" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "changeSummary" TEXT,
  "isEdited" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "servedAt" TIMESTAMP(3),
  "orderId" TEXT NOT NULL,
  "tableId" TEXT,
  "stationId" TEXT NOT NULL,
  "assignedToId" TEXT,
  CONSTRAINT "kitchen_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kitchen_tickets_status_idx" ON "kitchen_tickets"("status");
CREATE INDEX "kitchen_tickets_orderId_idx" ON "kitchen_tickets"("orderId");
CREATE INDEX "kitchen_tickets_tableId_idx" ON "kitchen_tickets"("tableId");
CREATE INDEX "kitchen_tickets_stationId_idx" ON "kitchen_tickets"("stationId");
CREATE INDEX "kitchen_tickets_assignedToId_idx" ON "kitchen_tickets"("assignedToId");

CREATE TABLE "kitchen_ticket_items" (
  "id" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "nameSnapshot" TEXT NOT NULL,
  "notes" TEXT,
  "changeType" TEXT NOT NULL DEFAULT 'UNCHANGED',
  "previousQty" INTEGER,
  "previousNotes" TEXT,
  "ticketId" TEXT NOT NULL,
  "orderItemId" TEXT,
  "menuItemId" TEXT NOT NULL,
  CONSTRAINT "kitchen_ticket_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kitchen_ticket_items_ticketId_idx" ON "kitchen_ticket_items"("ticketId");
CREATE INDEX "kitchen_ticket_items_orderItemId_idx" ON "kitchen_ticket_items"("orderItemId");
CREATE INDEX "kitchen_ticket_items_menuItemId_idx" ON "kitchen_ticket_items"("menuItemId");

CREATE TABLE "order_change_logs" (
  "id" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "order_change_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_change_logs_orderId_idx" ON "order_change_logs"("orderId");
CREATE INDEX "order_change_logs_userId_idx" ON "order_change_logs"("userId");

CREATE TABLE "transfer_proofs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "method" TEXT NOT NULL DEFAULT 'TRANSFER',
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "filePath" TEXT,
  "originalName" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "rejectionReason" TEXT,
  "purgedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "paymentId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "tableId" TEXT,
  "cashClosingId" TEXT,
  "submittedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  CONSTRAINT "transfer_proofs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transfer_proofs_status_idx" ON "transfer_proofs"("status");
CREATE INDEX "transfer_proofs_paymentId_idx" ON "transfer_proofs"("paymentId");
CREATE INDEX "transfer_proofs_orderId_idx" ON "transfer_proofs"("orderId");
CREATE INDEX "transfer_proofs_tableId_idx" ON "transfer_proofs"("tableId");
CREATE INDEX "transfer_proofs_cashClosingId_idx" ON "transfer_proofs"("cashClosingId");

CREATE TABLE "_KitchenStationToMenuCategory" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_KitchenStationToMenuCategory_AB_unique" ON "_KitchenStationToMenuCategory"("A", "B");
CREATE INDEX "_KitchenStationToMenuCategory_B_index" ON "_KitchenStationToMenuCategory"("B");

CREATE TABLE "_KitchenStationUsers" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL
);

CREATE UNIQUE INDEX "_KitchenStationUsers_AB_unique" ON "_KitchenStationUsers"("A", "B");
CREATE INDEX "_KitchenStationUsers_B_index" ON "_KitchenStationUsers"("B");

ALTER TABLE "orders" ADD CONSTRAINT "orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_cashRegisterId_fkey" FOREIGN KEY ("cashRegisterId") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_cashClosingId_fkey" FOREIGN KEY ("cashClosingId") REFERENCES "cash_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kitchen_tickets" ADD CONSTRAINT "kitchen_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "kitchen_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "kitchen_ticket_items" ADD CONSTRAINT "kitchen_ticket_items_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_change_logs" ADD CONSTRAINT "order_change_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_change_logs" ADD CONSTRAINT "order_change_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_proofs" ADD CONSTRAINT "transfer_proofs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_proofs" ADD CONSTRAINT "transfer_proofs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfer_proofs" ADD CONSTRAINT "transfer_proofs_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_proofs" ADD CONSTRAINT "transfer_proofs_cashClosingId_fkey" FOREIGN KEY ("cashClosingId") REFERENCES "cash_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfer_proofs" ADD CONSTRAINT "transfer_proofs_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transfer_proofs" ADD CONSTRAINT "transfer_proofs_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "_KitchenStationToMenuCategory" ADD CONSTRAINT "_KitchenStationToMenuCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_KitchenStationToMenuCategory" ADD CONSTRAINT "_KitchenStationToMenuCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_KitchenStationUsers" ADD CONSTRAINT "_KitchenStationUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_KitchenStationUsers" ADD CONSTRAINT "_KitchenStationUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
