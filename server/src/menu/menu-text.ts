export type MessagingMenuCategory = {
  name: string;
  items: Array<{
    name: string;
    price: number;
  }>;
};

/**
 * Texto plano que se muestra en WhatsApp y en la configuración de la carta.
 * Mantenerlo aquí evita que el envío y la vista de administración se separen.
 */
export function buildMessagingMenuText(categories: MessagingMenuCategory[]): string {
  const lines = ['📋 *MENÚ Y PRECIOS VILLA DOG*'];

  for (const category of categories) {
    const categoryName = String(category.name || '').trim();
    const items = Array.isArray(category.items) ? category.items : [];
    if (!categoryName || items.length === 0 || /^adiciones?$/i.test(categoryName)) continue;

    const displayName = /gaseosa|bebida/i.test(categoryName)
      ? 'GASEOSAS'
      : /jugo|agua/i.test(categoryName)
        ? 'JUGOS'
        : categoryName.toUpperCase();

    lines.push('', `*${displayName}*`);
    for (const item of items) {
      const name = String(item.name || '').trim();
      if (!name) continue;
      const price = Number(item.price || 0);
      lines.push(`- ${name}: $${price.toLocaleString('es-CO')}`);
    }
  }

  lines.push('', '🛵 ¿Qué se te antoja pedir? Cuéntanos qué productos deseas y te tomamos el pedido.');
  return lines.join('\n');
}
