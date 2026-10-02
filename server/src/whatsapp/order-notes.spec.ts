import { sanitizeOrderNote } from './order-notes';

describe('sanitizeOrderNote', () => {
  it.each([
    ['Pedir 12 perros que vengan bien calienticos', 'Perro Sencillo', 12, 'Bien calienticos', 0],
    ['2 perros, 1 sin cebolla', 'Perro Sencillo', 2, 'Sin cebolla', 1],
    ['2 perros únicamente con salsa de piña', 'Perro Sencillo', 2, 'Únicamente con salsa de piña', 0],
    ['sin salsas', 'Perro Sencillo', 1, 'Sin salsas', 0],
    ['con tártara aparte', 'Perro Sencillo', 1, 'Con tártara aparte', 0],
    ['salsa de piña aparte', 'Perro Sencillo', 1, 'Salsa de piña aparte', 0],
    ['tártara y piña aparte', 'Perro Sencillo', 1, 'Tártara y piña aparte', 0],
    ['papas al vapor', 'Hamburguesa Sencilla', 1, 'Papas al vapor', 0],
    ['bien asada', 'Hamburguesa Sencilla', 1, 'Bien asada', 0],
    ['poco queso', 'Perro Sencillo', 1, 'Poco queso', 0],
    ['más queso', 'Perro Sencillo', 1, 'Más queso', 0],
    ['extra queso', 'Perro Sencillo', 1, 'Extra queso', 0],
    ['sin cebolla por favor', 'Perro Sencillo', 1, 'Sin cebolla', 0],
    ['sin cebolla, gracias', 'Perro Sencillo', 1, 'Sin cebolla', 0],
    ['bien caliente por favor', 'Perro Sencillo', 1, 'Bien caliente', 0],
    ['salsa de piña aparte por favor', 'Perro Sencillo', 1, 'Salsa de piña aparte', 0],
    ['sin cebolla y la dirección es calle 20', 'Perro Sencillo', 1, 'Sin cebolla', 0],
    ['con salsa de piña, muchas gracias', 'Perro Sencillo', 1, 'Con salsa de piña', 0],
    ['sin cebolla muchísimas gracias', 'Perro Sencillo', 1, 'Sin cebolla', 0],
    ['salsas aparte, mil gracias', 'Perro Sencillo', 1, 'Salsas aparte', 0],
    ['bien caliente si puede por favor', 'Perro Sencillo', 1, 'Bien caliente', 0],
    ['sin cebolla y por favor', 'Perro Sencillo', 1, 'Sin cebolla', 0],
  ])('sanitizes %s', (raw, product, quantity, expectedNote, expectedPartialQty) => {
    expect(sanitizeOrderNote(raw, product, quantity)).toEqual({
      note: expectedNote,
      partialQty: expectedPartialQty,
    });
  });

  it.each([
    'quiero 12 perros a domicilio',
    'hola, buenas tardes',
    'pago por transferencia',
    'dirección calle 44 carrera 2',
    'teléfono 3001234567',
    'para las 6:15 p. m.',
    'únicamente con salsa de',
    '2 perros con amor por favor',
    'quiero pedir con ustedes',
    '2 perros con gusto',
    'dos perros con mi domicilio en La Granja',
    'con el pago en efectivo',
    'con el pedido para domicilio',
    'pago en efectivo con 50 mil',
    'pago con 20 mil',
    'voy a pagar con 50.000',
    'con 50 mil de cambio',
    'con referencia portón azul',
    'con apartamento 201',
    'con casa esquinera',
    'con nombre Juan',
    'con indicación llamar al llegar',
    'quiero hablar con alguien',
    'quiero el pedido sin demora',
  ])('rejects non-kitchen or incomplete text: %s', (raw) => {
    expect(sanitizeOrderNote(raw, 'Perro Sencillo', 12)).toEqual({
      note: '',
      partialQty: 0,
    });
  });

  it('drops operational data after a valid kitchen instruction', () => {
    expect(
      sanitizeOrderNote(
        '2 perros sin cebolla para las 6:15 y pago en efectivo',
        'Perro Sencillo',
        2,
      ),
    ).toEqual({ note: 'Sin cebolla', partialQty: 0 });
  });

  it('does not treat a product name containing "con" as a kitchen note', () => {
    expect(sanitizeOrderNote('2 Perro con Queso', 'Perro con Queso', 2)).toEqual({
      note: '',
      partialQty: 0,
    });
  });
});
