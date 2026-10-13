import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const targetSiteId = String(process.env.TARGET_SITE_ID || '').trim();

async function main() {
  if (!targetSiteId) {
    throw new Error(
      'Define TARGET_SITE_ID. La actualización de menú nunca puede ejecutarse globalmente.',
    );
  }
  const site = await prisma.site.findUnique({
    where: { id: targetSiteId },
    select: { id: true, name: true },
  });
  if (!site) throw new Error(`La sede ${targetSiteId} no existe.`);

  console.log(`🚀 Iniciando actualización del menú de ${site.name} (Julio 2026)...`);

  await prisma.$transaction(async (tx) => {
    // Marcar como inactivas todas las categorías y productos actuales para reemplazar de forma limpia
    await tx.menuItem.updateMany({ where: { siteId: targetSiteId }, data: { active: false } });
    await tx.menuCategory.updateMany({ where: { siteId: targetSiteId }, data: { active: false } });

    let catOrder = 1;

    async function getOrCreateCategory(name: string) {
      let cat = await tx.menuCategory.findFirst({
        where: { siteId: targetSiteId, name: { equals: name, mode: 'insensitive' } },
      });
      if (!cat) {
        cat = await tx.menuCategory.create({
          data: {
            siteId: targetSiteId,
            name,
            sortOrder: catOrder++,
            active: true
          }
        });
      } else {
        cat = await tx.menuCategory.update({
          where: { id: cat.id },
          data: { name, active: true, sortOrder: catOrder++ }
        });
      }
      return cat;
    }

    async function addOrUpdateItem(catId: string, name: string, price: number, description?: string, code?: string) {
      let item = await tx.menuItem.findFirst({
        where: {
          siteId: targetSiteId,
          categoryId: catId,
          name: { equals: name, mode: 'insensitive' }
        }
      });

      if (!item) {
        item = await tx.menuItem.create({
          data: {
            siteId: targetSiteId,
            name,
            price,
            description,
            code,
            categoryId: catId,
            active: true
          }
        });
      } else {
        item = await tx.menuItem.update({
          where: { id: item.id },
          data: {
            name,
            price,
            description,
            code,
            active: true
          }
        });
      }
      return item;
    }

    // ─────────────────────────────────────────────
    // 1. PIZZAS - RECETA ORIGINAL
    // ─────────────────────────────────────────────
    const catPizzasPersonal = await getOrCreateCategory('Pizzas Personales (25 cm - 6 porc)');
    const catPizzasMediana = await getOrCreateCategory('Pizzas Medianas (30 cm - 8 porc)');
    const catPizzasFamiliar = await getOrCreateCategory('Pizzas Familiares (40 cm - 8 porc)');
    const catPizzasExtra = await getOrCreateCategory('Pizzas Familiares Extragrande (50 cm - 12 porc)');

    const pizzaFlavors = [
      { name: 'Solo Queso', desc: 'Queso Mozzarella', p: 15000, m: 24500, f: 43000, fx: 62500 },
      { name: 'Jamón y Queso', desc: 'Queso Mozzarella y Jamón', p: 18500, m: 30000, f: 51500, fx: 76000 },
      { name: 'Salami', desc: 'Queso Mozzarella y Salami', p: 21500, m: 32000, f: 58000, fx: 85000 },
      { name: 'Hawaiana', desc: 'Queso Mozzarella, Jamón y Piña en trocitos', p: 21000, m: 34000, f: 58500, fx: 85000 },
      { name: 'Con Pollo', desc: 'Queso Mozzarella y Pollo en trocitos a la plancha', p: 21000, m: 31500, f: 57500, fx: 83000 },
      { name: 'Con Tocineta', desc: 'Queso Mozzarella y Tocineta Ahumada', p: 19500, m: 29500, f: 56000, fx: 80000 },
      { name: 'Con Maíz y Queso', desc: 'Queso Mozzarella y Maíz Tierno', p: 19000, m: 28500, f: 51000, fx: 73500 },
      { name: 'Con Pepperoni', desc: 'Queso Mozzarella y Pepperoni', p: 22000, m: 33500, f: 62000, fx: 92000 },
      { name: 'Con Chorizo', desc: 'Queso Mozzarella y Chorizo', p: 19600, m: 30000, f: 55000, fx: 80500 },
      { name: 'Vegetales', desc: 'Queso Mozzarella, Champiñones, Tomate, Cebolla, Pimentón, Orégano', p: 20600, m: 32000, f: 58500, fx: 85500 },
      { name: 'Con Champiñones', desc: 'Queso Mozzarella y Champiñones', p: 20000, m: 31000, f: 55000, fx: 79000 },
      
      // Especialidades
      { name: 'Pollo Jamón', desc: 'Queso Mozzarella, Jamón y Pollo en trocitos a la plancha', p: 23700, m: 38000, f: 66000, fx: 95500 },
      { name: 'Ranchera', desc: 'Queso Mozzarella, Jamón y Ranchera', p: 24000, m: 36500, f: 64000, fx: 95000 },
      { name: 'Pollo Tocineta', desc: 'Queso Mozzarella, Pollo en trocitos y Tocineta Ahumada', p: 24500, m: 36000, f: 66800, fx: 96000 },
      { name: 'Pollo Hawaiana', desc: 'Queso Mozzarella, Jamón, Piña en trocitos y Pollo en trocitos a la plancha', p: 25600, m: 42000, f: 72600, fx: 100500 },
      { name: 'Pollo Champiñones', desc: 'Queso Mozzarella, Pollo en trocitos a la plancha y Champiñones', p: 24000, m: 36500, f: 67000, fx: 95500 },
      { name: 'Americana', desc: 'Queso Mozzarella, Maíz Tierno y Pollo en trocitos a la plancha', p: 24000, m: 35500, f: 65500, fx: 91500 },
      { name: 'Especial Tío The Villa Dog', desc: 'Queso Mozzarella, Pollo en trocitos a la plancha, Jamón, Ranchera, Piña en trocitos', p: 32500, m: 45600, f: 86500, fx: 123000 },
      { name: 'Salami - Pollo', desc: 'Queso Mozzarella, Salami y Pollo en trocitos a la plancha', p: 24000, m: 37000, f: 69500, fx: 100000 },
      { name: 'Especial 4 Carnes', desc: 'Queso Mozzarella, Jamón, Salami, Pollo en trocitos a la plancha y Chorizo', p: 28500, m: 44000, f: 85500, fx: 122000 },
      { name: 'Especial Semi-Remontada', desc: 'Queso Mozzarella, Jamón, Pollo a la plancha, Salami, Tocineta ahumada, Chorizo, Maíz tierno, Cebolla y Piña', p: 39500, m: 55600, f: 108000, fx: 155000 },
    ];

    for (const item of pizzaFlavors) {
      await addOrUpdateItem(catPizzasPersonal.id, `Pizza ${item.name} Personal`, item.p, item.desc);
      await addOrUpdateItem(catPizzasMediana.id, `Pizza ${item.name} Mediana`, item.m, item.desc);
      await addOrUpdateItem(catPizzasFamiliar.id, `Pizza ${item.name} Familiar`, item.f, item.desc);
      await addOrUpdateItem(catPizzasExtra.id, `Pizza ${item.name} Extra Grande`, item.fx, item.desc);
    }

    // ─────────────────────────────────────────────
    // 2. ADICIONES Y BORDES PARA PIZZA
    // ─────────────────────────────────────────────
    const catAdicionesPizza = await getOrCreateCategory('Adiciones e Ingredientes para Pizza');
    const pizzaAdditions = [
      { name: 'Adición Queso Mozzarella', price: 7300 },
      { name: 'Adición Jamón', price: 4000 },
      { name: 'Adición Pollo en Trocitos', price: 6000 },
      { name: 'Adición Salami', price: 5500 },
      { name: 'Adición Ranchera Premium', price: 6000 },
      { name: 'Adición Chorizo', price: 5000 },
      { name: 'Adición Tocineta Ahumada', price: 5000 },
      { name: 'Adición Pepperoni Americano', price: 7500 },
      { name: 'Adición Maíz Tierno', price: 4000 },
      { name: 'Adición Piña de la Casa', price: 3000 },
      { name: 'Adición Champiñones', price: 5000 },
    ];
    for (const a of pizzaAdditions) {
      await addOrUpdateItem(catAdicionesPizza.id, a.name, a.price);
    }

    const catBordesPizza = await getOrCreateCategory('Bordes Rellenos de Pizza');
    const pizzaBordes = [
      { name: 'Borde Relleno de Queso Personal', price: 9000 },
      { name: 'Borde Relleno de Queso Mediana', price: 11000 },
      { name: 'Borde Relleno de Queso Familiar', price: 19500 },
      { name: 'Borde Relleno de Queso Extra Grande', price: 23000 },
      { name: 'Borde Relleno de Bocadillo Personal', price: 7000 },
      { name: 'Borde Relleno de Bocadillo Mediana', price: 9000 },
      { name: 'Borde Relleno de Bocadillo Familiar', price: 13000 },
      { name: 'Borde Relleno de Bocadillo Extra Grande', price: 17000 },
      { name: 'Borde Relleno Mixto (Queso y Bocadillo) Personal', price: 10000 },
      { name: 'Borde Relleno Mixto (Queso y Bocadillo) Mediana', price: 12000 },
      { name: 'Borde Relleno Mixto (Queso y Bocadillo) Familiar', price: 20000 },
      { name: 'Borde Relleno Mixto (Queso y Bocadillo) Extra Grande', price: 26000 },
    ];
    for (const b of pizzaBordes) {
      await addOrUpdateItem(catBordesPizza.id, b.name, b.price);
    }

    // ─────────────────────────────────────────────
    // 3. BEBIDAS
    // ─────────────────────────────────────────────
    const catBebidas = await getOrCreateCategory('Bebidas');
    const bebidasList = [
      // Familiares
      { name: 'Coca-Cola 3L PET', price: 17800 },
      { name: 'Manzana Postobón 3.125L PET', price: 17800 },
      { name: 'Gaseosa Postobón 1.5L PET', price: 10000 },
      { name: 'Coca-Cola 1.5L PET', price: 10000 },
      { name: 'Kola Román 1.5L NR', price: 10000 },
      { name: 'Quatro 1.5L', price: 10000 },
      { name: 'Del Valle 1.5L', price: 10000 },
      { name: 'Jugo Hit Tetra 1L', price: 9000 },
      // Personales
      { name: 'Gaseosa Postobón PET 400ml', price: 5000 },
      { name: 'Coca-Cola PET 400ml', price: 5000 },
      { name: 'Quatro PET 400ml', price: 5000 },
      { name: 'Kola Román PET 400ml', price: 5000 },
      { name: 'Del Valle 400ml', price: 5000 },
      { name: 'Jugo Hit 500ml', price: 5000 },
      { name: 'Bretaña 300ml', price: 5000 },
      { name: 'Hatsu Tea', price: 5500 },
      { name: 'Agua Botella 600ml', price: 3500 },
      // Junior
      { name: 'Gaseosa Postobón PET 250ml', price: 3200 },
      { name: 'Coca-Cola PET 250ml', price: 3200 },
      { name: 'Kola Román PET 250ml', price: 3200 },
      { name: 'Agua Botella 300ml', price: 1500 },
      { name: 'Agua Manzana 300ml', price: 3200 },
      // Cervezas
      { name: 'Coronita Extra', price: 5000 },
    ];
    for (const beb of bebidasList) {
      await addOrUpdateItem(catBebidas.id, beb.name, beb.price);
    }

    // ─────────────────────────────────────────────
    // 4. PERROS
    // ─────────────────────────────────────────────
    const catPerros = await getOrCreateCategory('Perros Calientes');
    const perrosList = [
      { name: 'Perro Super The Villa Dog', price: 22100, desc: 'Una salchicha long, pollo en trocitos, chorizo, butifarra, tocineta ahumada, jamón, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Italo Suizo', price: 15900, desc: 'Una salchicha suiza, tocineta ahumada, jamón, salami, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Especial The Villa Dog', price: 15500, desc: 'Una salchicha ranchera premium, salchicha suiza, jamón, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Combo', price: 15000, desc: 'Un perro sencillo, papas a la francesa + gaseosa' },
      { name: 'Perro Italo Ranchero', price: 12900, desc: 'Una salchicha ranchera premium, tocineta ahumada, jamón, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Suizo', price: 13700, desc: 'Una salchicha suiza, salami, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Americano', price: 10900, desc: 'Una salchicha long, salchicha suiza, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Con Pollo', price: 11700, desc: 'Una salchicha long, filete de pechuga en trocitos, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Escocés', price: 10600, desc: 'Una salchicha long, maíz tierno, salami, jamón, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Ranchero', price: 11700, desc: 'Una salchicha ranchera premium, jamón, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Gemelo', price: 10100, desc: '2 salchichas long, queso costeño y doble mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Con Tocineta', price: 9000, desc: 'Una salchicha long, tocineta ahumada, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Chori Perro', price: 10500, desc: 'Una salchicha long, chorizo con ternera, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Suizito', price: 8900, desc: 'Media salchicha suiza, queso costeño y mozzarella (con vegetales y papa triturada)' },
      { name: 'Perro Sencillo', price: 7800, desc: 'Una salchicha long, jamón, queso costeño y mozzarella (con vegetales y papa triturada)' },
    ];
    for (const p of perrosList) {
      await addOrUpdateItem(catPerros.id, p.name, p.price, p.desc);
    }

    // ─────────────────────────────────────────────
    // 5. HAMBURGUESAS
    // ─────────────────────────────────────────────
    const catHamburguesas = await getOrCreateCategory('Hamburguesas');
    const hamburguesasList = [
      { name: 'Hamburguesa Super Especial The Villa Dog', price: 23700, desc: 'Carne, pollo, cerdo, tocineta, jamón y queso mozzarella (con vegetales)' },
      { name: 'Hamburguesa Especial The Villa Dog', price: 19100, desc: 'Carne, pollo, tocineta, jamón y queso mozzarella (con vegetales)' },
      { name: 'Hamburguesa Combo', price: 20100, desc: '1 hamburguesa sencilla, papas a la francesa + gaseosa' },
      { name: 'Hamburguesa Ranchera Especial', price: 20100, desc: 'Carne, ranchera, tocineta, jamón y queso mozzarella (con vegetales)' },
      { name: 'Hamburguesa Mixta', price: 16900, desc: 'Carne, pollo y queso mozzarella (con vegetales)' },
      { name: 'Hamburguesa Doble Carne', price: 16900, desc: '2 carnes, doble queso mozzarella (con vegetales)' },
      { name: 'Hamburguesa Sencilla', price: 13500, desc: 'Carne, tocineta, jamón y queso mozzarella (con vegetales)' },
      { name: 'Hamburguesa Con Pollo', price: 11300, desc: 'Filete de pechuga a la parrilla y queso mozzarella (con vegetales)' },
    ];
    for (const h of hamburguesasList) {
      await addOrUpdateItem(catHamburguesas.id, h.name, h.price, h.desc);
    }

    // ─────────────────────────────────────────────
    // 6. PATACONES RELLENOS
    // ─────────────────────────────────────────────
    const catPataconesSencillos = await getOrCreateCategory('Patacones Rellenos (Sencillos)');
    const catPataconesGratinados = await getOrCreateCategory('Patacones Rellenos (Gratinados)');

    const pataconesList = [
      { name: 'Señor The Villa Dog Patacón', desc: 'Pollo, lomo de res, cerdo, suiza, ranchera, cervecero, aguacate, nachos y maíz tierno', s: 51000, g: 56000 },
      { name: 'Patacón Con Todo', desc: 'Pollo, lomo de res, suiza, chorizo y butifarra', s: 29800, g: 33800 },
      { name: 'Patacón Trifásico', desc: 'Filete de pechuga, cerdo magro y lomo de res en trocitos', s: 25700, g: 29700 },
      { name: 'Patacón Suizo al Gratín', desc: 'Con salchicha suiza premium y queso mozzarella gratinado', s: 22500, g: 22500 },
      { name: 'Patacón Mixto', desc: 'Filete de pechuga y lomo de res en trocitos', s: 21100, g: 25100 },
      { name: 'Patacón Con Lomito', desc: 'Lomo de res en trocitos', s: 22000, g: 26000 },
      { name: 'Patacón Con Cerdo', desc: 'Cerdo magro en trocitos', s: 20200, g: 24200 },
      { name: 'Patacón Con Pollo', desc: 'Filete de pechuga en trocitos', s: 20200, g: 24200 },
      { name: 'Patacón Con Suiza, Chorizo y Butifarra', desc: 'Suiza, chorizo y butifarra', s: 19700, g: 23700 },
      { name: 'Patacón Con Pollo y Ranchera', desc: 'Filete de pechuga y salchicha ranchera premium', s: 21200, g: 25200 },
      { name: 'Patacón Con Ranchera', desc: 'Salchicha ranchera premium', s: 22200, g: 26200 },
    ];
    for (const pat of pataconesList) {
      await addOrUpdateItem(catPataconesSencillos.id, `${pat.name}`, pat.s, pat.desc);
      await addOrUpdateItem(catPataconesGratinados.id, `${pat.name} Gratinado`, pat.g, pat.desc);
    }

    // ─────────────────────────────────────────────
    // 7. SALVAJADAS
    // ─────────────────────────────────────────────
    const catSalvajadasSencillas = await getOrCreateCategory('Salvajadas (Sencillas)');
    const catSalvajadasGratinadas = await getOrCreateCategory('Salvajadas (Gratinadas)');

    const salvajadasList = [
      { name: 'Salvajada Chica', desc: 'Pollo, chorizo, butifarra, salchicha, cervecero (con vegetales, papas a la francesa, queso costeño y papa triturada)', s: 27000, g: 32000 },
      { name: 'Salvajada Matrimonio', desc: 'Pollo, chorizo, butifarra, salchicha, cervecero y maíz tierno', s: 34000, g: 39000 },
      { name: 'Salvajada Trío', desc: 'Pollo, cerdo, chorizo, butifarra, cervecero y salchicha', s: 39400, g: 45000 },
      { name: 'Salvajada Super', desc: 'Pollo, cerdo, chorizo, butifarra, cervecero y salchicha', s: 55500, g: 65000 },
      { name: 'Salvajada The Villa Dog', desc: 'Cerdo, pollo, salchicha, chorizo, cervecero y butifarra', s: 77500, g: 89500 },
      { name: 'Salvajada Extralargue', desc: 'Cerdo, pollo, suiza, chorizo, butifarra, salchicha, cervecero y maíz tierno', s: 106500, g: 121500 },
      { name: 'Salvajada Salvajadita', desc: 'Suiza, chorizo, butifarra y salchicha', s: 24200, g: 29200 },
    ];
    for (const sal of salvajadasList) {
      await addOrUpdateItem(catSalvajadasSencillas.id, `${sal.name}`, sal.s, sal.desc);
      await addOrUpdateItem(catSalvajadasGratinadas.id, `${sal.name} Gratinada`, sal.g, sal.desc);
    }

    // ─────────────────────────────────────────────
    // 8. SUIZOS Y MINI SUIZOS (Con Papas a la Francesa & Con Papas al Vapor)
    // ─────────────────────────────────────────────
    const catSuizosFrancesa = await getOrCreateCategory('Suizos (Con Papas a la Francesa)');
    const catSuizosFrancesaGrat = await getOrCreateCategory('Suizos Gratinados (Con Papas a la Francesa)');
    const catSuizosVapor = await getOrCreateCategory('Suizos (Con Papas al Vapor)');
    const catSuizosVaporGrat = await getOrCreateCategory('Suizos Gratinados (Con Papas al Vapor)');

    const suizosList = [
      { name: 'Suizo Especial The Villa Dog', desc: 'Pollo, lomito, cerdo, suiza, chorizo, cervecero, butifarra y cebolla', fs: 78500, fg: 90500, vs: 74600, vg: 86600 },
      { name: 'Suizo Super Con Todo', desc: 'Pollo, cerdo, suiza, chorizo, cervecero, butifarra y cebolla', fs: 45000, fg: 50000, vs: 40600, vg: 45600 },
      { name: 'Suizo Con Todo', desc: 'Pollo, lomito, suiza, chorizo, butifarra y cebolla', fs: 36500, fg: 41500, vs: 33700, vg: 38700 },
      { name: 'Suizo Especial Con Lomito', desc: 'Salchicha suiza premium y lomo de res en trocitos', fs: 25000, fg: 29000, vs: 24000, vg: 28000 },
      { name: 'Suizo Especial Con Cerdo', desc: 'Salchicha suiza premium y cerdo magro en trocitos', fs: 24100, fg: 28100, vs: 21900, vg: 25900 },
      { name: 'Suizo Especial Con Pollo', desc: 'Salchicha suiza premium y filete de pechuga en trocitos', fs: 24100, fg: 28100, vs: 21900, vg: 25900 },
      { name: 'Suizo Ranchero', desc: 'Salchicha suiza, ranchera premium, tocineta ahumada y jamón', fs: 24000, fg: 28000, vs: 21800, vg: 25800 },
      { name: 'Super Suizo', desc: 'Con salchicha suiza premium', fs: 19500, fg: 23500, vs: 17300, vg: 21300 },
      { name: 'Suizo Chorizo y Butifarra', desc: 'Chorizo y butifarra con salchicha suiza', fs: 20700, fg: 24700, vs: 18500, vg: 22500 },
    ];
    for (const suiz of suizosList) {
      await addOrUpdateItem(catSuizosFrancesa.id, `${suiz.name} (Papas Francesa)`, suiz.fs, suiz.desc);
      await addOrUpdateItem(catSuizosFrancesaGrat.id, `${suiz.name} Gratinado (Papas Francesa)`, suiz.fg, suiz.desc);
      await addOrUpdateItem(catSuizosVapor.id, `${suiz.name} (Papas al Vapor)`, suiz.vs, suiz.desc);
      await addOrUpdateItem(catSuizosVaporGrat.id, `${suiz.name} Gratinado (Papas al Vapor)`, suiz.vg, suiz.desc);
    }

    // Mini Suizos
    const catMiniSuizosFrancesa = await getOrCreateCategory('Mini Suizos (Con Papas a la Francesa)');
    const catMiniSuizosFrancesaGrat = await getOrCreateCategory('Mini Suizos Gratinados (Con Papas a la Francesa)');
    const catMiniSuizosVapor = await getOrCreateCategory('Mini Suizos (Con Papas al Vapor)');
    const catMiniSuizosVaporGrat = await getOrCreateCategory('Mini Suizos Gratinados (Con Papas al Vapor)');

    const miniSuizosList = [
      { name: 'Mini Suizo Especial Con Lomito', desc: 'Salchicha suiza premium y lomo de res en trocitos', fs: 18200, fg: 21200, vs: 17200, vg: 20200 },
      { name: 'Mini Suizo Especial Con Cerdo', desc: 'Salchicha suiza premium y cerdo magro en trocitos', fs: 17300, fg: 20300, vs: 16300, vg: 19300 },
      { name: 'Mini Suizo Especial Con Pollo', desc: 'Salchicha suiza premium y filete de pechuga en trocitos', fs: 17300, fg: 20300, vs: 16300, vg: 19300 },
      { name: 'Mini Suizo Sencillo', desc: 'Salchicha suiza premium', fs: 12700, fg: 15700, vs: 11700, vg: 14700 },
    ];
    for (const ms of miniSuizosList) {
      await addOrUpdateItem(catMiniSuizosFrancesa.id, `${ms.name} (Papas Francesa)`, ms.fs, ms.desc);
      await addOrUpdateItem(catMiniSuizosFrancesaGrat.id, `${ms.name} Gratinado (Papas Francesa)`, ms.fg, ms.desc);
      await addOrUpdateItem(catMiniSuizosVapor.id, `${ms.name} (Papas al Vapor)`, ms.vs, ms.desc);
      await addOrUpdateItem(catMiniSuizosVaporGrat.id, `${ms.name} Gratinado (Papas al Vapor)`, ms.vg, ms.desc);
    }

    // ─────────────────────────────────────────────
    // 9. PICADAS Y MAICITOS
    // ─────────────────────────────────────────────
    const catPicadasSencillas = await getOrCreateCategory('Picadas (Sencillas)');
    const catPicadasGratinadas = await getOrCreateCategory('Picadas (Gratinadas)');

    const picadasList = [
      { name: 'Picada Super Especial The Villa Dog', desc: 'Pollo, lomito, cerdo, suiza, ranchera, chorizo, cervecero, butifarra, maíz tierno (con vegetales, papas trituradas y queso costeño)', s: 101000, g: 116000 },
      { name: 'Picada Especial The Villa Dog', desc: 'Pollo, lomito, cerdo, suiza, chorizo, cervecero y butifarra', s: 72500, g: 84500 },
      { name: 'Picada Super Con Todo', desc: 'Pollo, cerdo, suiza, chorizo, cervecero y butifarra', s: 44000, g: 49000 },
      { name: 'Picada Con Todo', desc: 'Pollo, lomito, suiza, chorizo y butifarra', s: 35500, g: 40500 },
      { name: 'Picada Escocesa', desc: 'Pollo, lomito, cerdo, suiza y maíz tierno', s: 39000, g: 44000 },
      { name: 'Picada Cuatro Carnes', desc: 'Pollo, lomito, cerdo y chorizo', s: 37000, g: 42000 },
      { name: 'Picada Trifásica', desc: 'Lomo de res, cerdo y filete de pechuga en trocitos', s: 25900, g: 29900 },
      { name: 'Picada Mixta', desc: 'Lomo de res y filete de pechuga en trocitos', s: 21300, g: 25300 },
      { name: 'Picada Con Lomito', desc: 'Lomo de res en trocitos', s: 22200, g: 26200 },
      { name: 'Picada Con Cerdo', desc: 'Cerdo magro en trocitos', s: 20400, g: 24400 },
      { name: 'Picada Con Pollo', desc: 'Filete de pechuga en trocitos', s: 20400, g: 24400 },
      { name: 'Picada Con Suiza, Chorizo y Butifarra', desc: 'Suiza, chorizo y butifarra', s: 19900, g: 23900 },
      { name: 'Picada Con Pollo y Ranchera', desc: 'Pollo y ranchera premium', s: 21400, g: 25400 },
      { name: 'Picada Con Ranchera', desc: 'Salchicha ranchera premium', s: 22400, g: 26400 },
    ];
    for (const pic of picadasList) {
      await addOrUpdateItem(catPicadasSencillas.id, `${pic.name}`, pic.s, pic.desc);
      await addOrUpdateItem(catPicadasGratinadas.id, `${pic.name} Gratinada`, pic.g, pic.desc);
    }

    const catMaicitosSencillos = await getOrCreateCategory('Maicitos (Sencillos)');
    const catMaicitosGratinados = await getOrCreateCategory('Maicitos (Gratinados)');

    const maicitosList = [
      { name: 'Maicito Cuatro Carnes', desc: 'Maíz tierno, pollo, lomito, chorizo y cerdo (con vegetales, queso costeño y papa triturada)', s: 33000, g: 38000 },
      { name: 'Maicito Con Todo', desc: 'Maíz tierno, pollo, lomito, suiza, chorizo y butifarra', s: 34500, g: 39500 },
      { name: 'Maicito Trifásico', desc: 'Maíz tierno, pollo, lomito y cerdo', s: 27100, g: 32100 },
      { name: 'Maicito Con Ranchera Y Pollo', desc: 'Maíz tierno, salchicha ranchera y pollo en trocitos', s: 22700, g: 26800 },
      { name: 'Maicito Hawaiano', desc: 'Maíz tierno, tocineta, jamón y piña en trocitos', s: 21000, g: 25000 },
      { name: 'Maicito Con Ranchera', desc: 'Maíz tierno y ranchera', s: 18100, g: 22100 },
      { name: 'Maicito Con Lomito', desc: 'Maíz tierno y res en trocitos', s: 17900, g: 21900 },
      { name: 'Maicito Con Cerdo', desc: 'Maíz tierno y cerdo en trocitos', s: 17100, g: 21100 },
      { name: 'Maicito Con Pollo', desc: 'Maíz tierno y pollo en trocitos', s: 17100, g: 21100 },
      { name: 'Maíz Americano Sencillo', desc: 'Maíz tierno con queso costeño y papa triturada', s: 12500, g: 16500 },
    ];
    for (const mai of maicitosList) {
      await addOrUpdateItem(catMaicitosSencillos.id, `${mai.name}`, mai.s, mai.desc);
      await addOrUpdateItem(catMaicitosGratinados.id, `${mai.name} Gratinado`, mai.g, mai.desc);
    }

    // ─────────────────────────────────────────────
    // 10. SALCHIPAPAS Y CHUZOS
    // ─────────────────────────────────────────────
    const catSalchipapasSencillas = await getOrCreateCategory('Salchipapas (Sencillas)');
    const catSalchipapasGratinadas = await getOrCreateCategory('Salchipapas (Gratinadas)');

    const salchipapasList = [
      { name: 'Salchipapa Super Con Todo', desc: 'Salchicha, chorizo, butifarra, suiza, filete de pechuga y cerdo magro en trocitos', s: 44000, g: 49000 },
      { name: 'Salchipapa Con Todo', desc: 'Salchicha, chorizo, butifarra, filete de pechuga y lomo de res en trocitos', s: 33800, g: 38800 },
      { name: 'Salchipapa Cuatro Carnes', desc: 'Salchicha, filete de pechuga, lomo de res y cerdo magro en trocitos', s: 33600, g: 38600 },
      { name: 'Salchipapa Hawaiana', desc: 'Salchicha, tocineta ahumada, jamón y piña en trocitos', s: 21800, g: 25800 },
      { name: 'Salchipapa Suiza', desc: 'Con salchicha suiza premium', s: 18700, g: 22700 },
      { name: 'Salchipapa Con Lomito', desc: 'Salchicha y lomo de res en trocitos', s: 20000, g: 24000 },
      { name: 'Salchipapa Con Cerdo', desc: 'Salchicha y cerdo magro en trocitos', s: 19100, g: 23100 },
      { name: 'Salchipapa Con Pollo', desc: 'Salchicha y filete de pechuga en trocitos', s: 19100, g: 23100 },
      { name: 'Salchipapa Con Chorizo Y Butifarra', desc: 'Salchicha, chorizo y butifarra', s: 19400, g: 23400 },
      { name: 'Salchipapa Ranchi Papa', desc: 'Con salchicha ranchera premium', s: 22400, g: 26400 },
      { name: 'Salchipapa Chori Papa', desc: 'Con chorizo de ternera premium', s: 16600, g: 20600 },
      { name: 'Salchipapa Sencilla', desc: 'Salchicha manguera premium', s: 14500, g: 18500 },
    ];
    for (const salch of salchipapasList) {
      await addOrUpdateItem(catSalchipapasSencillas.id, `${salch.name}`, salch.s, salch.desc);
      await addOrUpdateItem(catSalchipapasGratinadas.id, `${salch.name} Gratinada`, salch.g, salch.desc);
    }

    const catChuzosFrancesa = await getOrCreateCategory('Chuzos (Con Patacones o Papas a la Francesa)');
    await addOrUpdateItem(catChuzosFrancesa.id, 'Chuzo Con Cerdo (Papas Francesa / Patacón)', 13300, 'Cerdo magro en chuzo');
    await addOrUpdateItem(catChuzosFrancesa.id, 'Chuzo Con Pollo (Papas Francesa / Patacón)', 13300, 'Filete de pechuga en chuzo');

    const catChuzosVapor = await getOrCreateCategory('Chuzos (Con Papas al Vapor)');
    await addOrUpdateItem(catChuzosVapor.id, 'Chuzo Con Cerdo (Papas al Vapor)', 11600, 'Cerdo magro en chuzo');
    await addOrUpdateItem(catChuzosVapor.id, 'Chuzo Con Pollo (Papas al Vapor)', 11600, 'Filete de pechuga en chuzo');

    // ─────────────────────────────────────────────
    // 11. ASADOS
    // ─────────────────────────────────────────────
    const catAsadosFrancesa = await getOrCreateCategory('Asados (Con Papas a la Francesa)');
    const catAsadosVapor = await getOrCreateCategory('Asados (Con Papas al Vapor)');

    const asadosList = [
      { name: 'Lomo Fino de Res x300g Antes de Asar', f: 32000, v: 29800 },
      { name: 'Lomo Fino de Res Encebollado', f: 34000, v: 31800 },
      { name: 'Lomo de Res 300g Antes de Asar', f: 25500, v: 23300 },
      { name: 'Lomo de Res Encebollado', f: 27500, v: 25300 },
      { name: 'Lomo de Cerdo x300g Antes de Asar', f: 24000, v: 21800 },
      { name: 'Lomo de Cerdo Encebollado', f: 26000, v: 23800 },
      { name: 'Pechuga x300g Antes de Asar', f: 22000, v: 20300 },
      { name: 'Pechuga Encebollada y Gratinada', f: 28000, v: 26300 },
      { name: 'Pechuga Encebollada', f: 22500, v: 24000 },
      { name: 'Porción de Carne de Res x200g Antes de Asar', f: 18600, v: 17000 },
      { name: 'Porción Cerdo x200g Antes de Asar', f: 16500, v: 15000 },
      { name: 'Porción Pechuga x200g Antes de Asar', f: 15500, v: 14000 },
    ];
    for (const asad of asadosList) {
      await addOrUpdateItem(catAsadosFrancesa.id, `${asad.name} (Papas Francesa)`, asad.f);
      await addOrUpdateItem(catAsadosVapor.id, `${asad.name} (Papas al Vapor)`, asad.v);
    }

    // ─────────────────────────────────────────────
    // 12. ADICIONALES GENERALES
    // ─────────────────────────────────────────────
    const catAdicionalesGenerales = await getOrCreateCategory('Adicionales y Porciones Generales');
    const adicionalesGeneralesList = [
      { name: '1 Salchicha Super Perro', price: 2000 },
      { name: 'Porción de Salchicha Manguera 113g', price: 3200 },
      { name: '1 Salchicha Ranchera', price: 5600 },
      { name: '1 Salchicha Suiza', price: 7500 },
      { name: 'Media Salchicha Suiza', price: 4000 },
      { name: '1 Porción de Butifarra', price: 3300 },
      { name: '1 Chorizo de Ternera', price: 2700 },
      { name: '1 Porción de Tocineta 100g', price: 4000 },
      { name: 'Porción de Papas a la Francesa 180g', price: 5400 },
      { name: 'Porción de Papas al Vapor 300g', price: 3000 },
      { name: 'Porción de Jamón 50g', price: 3000 },
      { name: 'Porción de Maíz x100g', price: 3400 },
      { name: 'Porción de Patacones 7 ud', price: 5400 },
      { name: '1 Carne de Hamburguesa 100g', price: 4600 },
      { name: '1 Porción de Pollo de Hamburguesa 130g', price: 4600 },
      { name: '1 Porción de Pollo en Trocitos 130g', price: 4600 },
      { name: 'Porción de Cerdo en Trocitos x130g', price: 4600 },
      { name: 'Porción de Lomito en Trocitos x120g', price: 5500 },
    ];
    for (const adig of adicionalesGeneralesList) {
      await addOrUpdateItem(catAdicionalesGenerales.id, adig.name, adig.price);
    }
  }, { timeout: 300000 });

  const totalCategories = await prisma.menuCategory.count({ where: { active: true } });
  const totalItems = await prisma.menuItem.count({ where: { active: true } });

  console.log(`✨ ¡Menú actualizado con éxito a partir de 20260627-niche-menu-full.pdf!`);
  console.log(`Categorías activas: ${totalCategories}`);
  console.log(`Productos activos: ${totalItems}`);
}

main()
  .catch(e => {
    console.error('Error al actualizar el menú:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
