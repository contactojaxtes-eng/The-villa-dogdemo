import { buildMessagingMenuText } from './menu-text';

describe('buildMessagingMenuText', () => {
  it('formats active menu categories as the text shared by WhatsApp', () => {
    expect(buildMessagingMenuText([
      { name: 'Perros calientes', items: [{ name: 'Perro Sencillo', price: 3500 }] },
      { name: 'Adiciones', items: [{ name: 'Queso', price: 1500 }] },
      { name: 'Gaseosas y bebidas', items: [{ name: 'Coca Cola 400ml', price: 4000 }] },
    ])).toBe([
      '📋 *MENÚ Y PRECIOS VILLA DOG*',
      '',
      '*PERROS CALIENTES*',
      '- Perro Sencillo: $3.500',
      '',
      '*GASEOSAS*',
      '- Coca Cola 400ml: $4.000',
      '',
      '🛵 ¿Qué se te antoja pedir? Cuéntanos qué productos deseas y te tomamos el pedido.',
    ].join('\n'));
  });
});
