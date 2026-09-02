const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const descriptions = {
  // PIZZAS
  "SOLO QUESO": "QUESO MOZZARELLA",
  "JAMÓN Y QUESO": "QUESO MOZZARELLA Y JAMÓN",
  "SALAMI": "QUESO MOZZARELLA Y SALAMI",
  "HAWAIANA": "QUESO MOZZARELLA, JAMON Y PIÑA EN TROCITOS",
  "CON POLLO": "QUESO MOZZARELLA Y POLLO EN TROCITOS A LA PLANCHA",
  "CON TOCINETA": "QUESO MOZZARELLA Y TOCINETA AHUMADA",
  "CON MAIZ Y QUESO": "QUESO MOZZARELLA Y MAIZ TIERNO",
  "CON PEPPERONI": "QUESO MOZZARELLA Y PEPPERONI",
  "CON CHORIZO": "QUESO MOZZARELLA Y CHORIZO",
  "VEGETALES": "QUESO MOZZARELLA, CHAMPIÑONES , TOMATE , CEBOLLA , PIMENTÓN, ORÉGANO",
  "CON CHAMPIÑONES": "QUESO MOZZARELLA Y CHAMPIÑONES",
  "POLLO JAMÓN": "QUESO MOZZARELLA, JAMON Y POLLO EN TROCITOS A LA PLANCHA",
  "RANCHERA": "QUESO MOZZARELLA, JAMON Y RANCHERA",
  "POLLO TOCINETA": "QUESO MOZZARELLA, POLLO EN TROCITOS Y TOCINETA AHUMADA",
  "POLLO HAWAIANA": "QUESO MOZZARELLA, JAMON, PIÑA EN TROCITOS Y POLLO EN TROCITOS A LA PLANCHA",
  "POLLO CHAMPIÑONES": "QUESO MOZZARELLA, POLLO EN TROCITOS A LA PLANCHA Y CHAMPIÑONES",
  "AMERICANA": "QUESO MOZZARELLA, MAÍZ TIERNO Y POLLO EN TROCITOS A LA PLANCHA",
  "ESPECIAL TIO THE VILLA DOG": "QUESO MOZZARELLA, POLLO EN TROCITOS A LA PLANCHA, JAMON, RANCHERA, PIÑA EN TROCITOS",
  "SALAMI - POLLO": "QUESO MOZZARELLA, SALAMI Y POLLO EN TROCITOS A LA PLANCHA",
  "ESPECIAL 4 CARNES": "QUESO MOZZARELLA, JAMON, SALAMI, POLLO EN TROCITOS A LA PLANCHA Y CHORIZO",
  "ESPECIAL SEMI-REMONTADA": "QUESO MOZZARELLA, JAMON, POLLO EN TROCITOS A LA PLANCHA, SALAMI, TOCINETA AHUMADA, CHORIZO, MAÍZ TIERNO, CEBOLLA Y PIÑA EN TROCITOS",

  // PERROS
  "SUPER THE VILLA DOG": "Una salchicha long, pollo en trocitos, chorizo, butifarra, tocineta ahumada, jamon, queso costeño y mozzarella",
  "ITALO SUIZO": "Una salchicha suiza, tocineta ahumada, jamón, salami, queso costeño y mozzarella",
  "ESPECIAL THE VILLA DOG": "Una salchicha ranchera premium, salchicha suiza, jamón, queso costeño y mozzarella",
  "COMBO": "Un perro sencillo, papas a la francesa + gaseosa",
  "ITALO RANCHERO": "Una salchicha ranchera premium, tocineta ahumada, jamón, queso costeño y mozzarella",
  "SUIZO": "Una salchicha suiza, salami, queso costeño y mozzarella",
  "AMERICANO": "Una salchicha long, salchicha suiza, queso costeño y mozzarella",
  "ESCOSES": "Una salchicha long, maíz tierno, salami, jamón, queso costeño y mozzarella",
  "RANCHERO": "Una salchicha ranchera premium, jamón, queso costeño y mozzarella",
  "GEMELO": "2 salchichas long, queso costeño y doble mozzarella",
  "CHORI PERRO": "Una salchicha long, chorizo con ternera, queso costeño y mozzarella",
  "SUIZITO": "Media salchicha suiza, queso costeño y mozzarella",
  "SENCILLO": "Una salchicha long, jamón, queso costeño y mozzarella",

  // HAMBURGUESAS
  "SUPER ESPECIAL THE VILLA DOG": "Carne, pollo, cerdo, tocineta, jamón y queso mozzarella",
  "RANCHERA ESPECIAL": "Carne, ranchera, tocineta, jamón y queso mozzarella",
  "MIXTA": "Carne, pollo y queso mozzarella",
  "DOBLE CARNE": "2 carnes, doble queso mozzarella",

  // PATACONES RELLENOS
  "SEÑOR THE VILLA DOG PATACÓN": "Pollo, lomo de res, cerdo, suiza, ranchera, cervecero, aguacate, nachos y maíz tierno",
  "TRIFÁSICO": "Filete de pechuga, cerdo magro y lomo de res en trocitos",
  "SUIZO AL GRATÍN": "Con salchicha suiza premium y queso mozzarella gratinado",
  "MIXTO": "Filete de pechuga y lomo de res en trocitos",
  "CON LOMITO": "Lomo de res en trocitos",
  "CON CERDO": "Cerdo magro en trocitos",
  "CON SUIZA,CHORIZO Y BUTIFARRA": "Salchicha suiza premium, chorizo y butifarra",
  "CON POLLO Y RANCHERA": "Filete de pechuga y salchicha ranchera premium",

  // SALVAJADAS
  "CHICA": "Pollo, chorizo, butifarra, salchicha, cervecero",
  "MATRIMONIO": "Pollo, chorizo, butifarra, salchicha, cervecero y maíz tierno",
  "TRIO": "Pollo, cerdo, chorizo, butifarra, cervecero y salchicha",
  "SUPER": "Pollo, cerdo, chorizo, butifarra, cervecero y salchicha",
  "THE VILLA DOG": "Cerdo, pollo, salchicha, chorizo, cervecero y butifarra",
  "EXTRALARGUE": "Cerdo, pollo, suiza, chorizo, butifarra, salchicha, cervecero y maíz tierno",
  "SALVAJADITA": "Suiza, chorizo, butifarra y salchicha",

  // SUIZOS
  "SUPER CON TODO": "Pollo, cerdo, suiza, chorizo, cervecero, butifarra y cebolla",
  "ESPECIAL CON LOMITO": "Salchicha suiza premium y lomo de res en trocitos",
  "ESPECIAL CON CERDO": "Salchicha suiza premium y cerdo magro en trocitos",
  "ESPECIAL CON POLLO": "Salchicha suiza premium y filete de pechuga en trocitos",
  "SUPER SUIZO": "Con salchicha suiza premium",
  "SUIZO CHORIZO Y BUTIFARRA": "Salchicha suiza, chorizo y butifarra",

  // PICADAS
  "ESCOCESA": "Pollo, lomito, cerdo, suiza y maíz tierno",
  "CUATRO CARNES": "Pollo, lomito, cerdo y chorizo",
  "TRIFÁSICA": "Lomo de res, cerdo y filete de pechuga en trocitos",
  "CON SUIZA, CHIORIZO Y BUTIFARRA": "Salchicha suiza, chorizo y butifarra",

  // MAICITOS
  "HAWAIANO": "Maíz tierno, tocineta, jamón y piña en trocitos",

  // SALCHIPAPAS
  "RANCHI PAPA": "Con salchicha ranchera premium",
  "CHORI PAPA": "Con chorizo de ternera premium",
  "SALCHIPAPA SENCILLA": "Salchicha manguera premium"
};

async function main() {
  const items = await prisma.menuItem.findMany();
  let updatedCount = 0;
  for (const item of items) {
    const removeAccents = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const normName = removeAccents(item.name);
    
    let desc = null;
    
    // Buscar la clave más larga que coincida para evitar que 'SUIZO' coincida con 'ITALO SUIZO' erróneamente, 
    // aunque normName.includes() buscaría si "Pizza Especial Tio The Villa Dog" incluye "ESPECIAL TIO THE VILLA DOG".
    const sortedKeys = Object.keys(descriptions).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      const normKey = removeAccents(key);
      if (normName.includes(normKey)) {
        desc = descriptions[key];
        break;
      }
    }
    if (desc) {
      await prisma.menuItem.update({
        where: { id: item.id },
        data: { description: desc }
      });
      updatedCount++;
    } else {
      // Intentar buscar de forma parcial (CON POLLO, CON TODO, etc)
      if (item.name.toUpperCase() === 'CON TODO') {
        let text = "";
        if (item.categoryId) {
          const cat = await prisma.category.findUnique({where: {id: item.categoryId}});
          if (cat.name.includes("Patacones")) text = descriptions["CON TODO"]; // "Pollo, lomo de res, suiza, chorizo y butifarra" (from Patacones)
          else if (cat.name.includes("Salchipapa")) text = "Salchicha, chorizo, butifarra, filete de pechuga y lomo de res en trocitos";
          else if (cat.name.includes("Suizos")) text = "Pollo, lomito, suiza, chorizo, butifarra y cebolla";
          else if (cat.name.includes("Picadas")) text = "Pollo, lomito, suiza, chorizo, y butifarra";
          else if (cat.name.includes("Maicitos")) text = "Maíz tierno, pollo, lomito, suiza, chorizo y butifarra";
        }
        if (text) {
          await prisma.menuItem.update({where: { id: item.id }, data: { description: text }});
          updatedCount++;
        }
      }
      else if (item.name.toUpperCase() === 'CON POLLO') {
        let text = "";
        if (item.categoryId) {
          const cat = await prisma.category.findUnique({where: {id: item.categoryId}});
          if (cat.name.includes("Pizza")) text = descriptions["CON POLLO"];
          else if (cat.name.includes("Perros")) text = "Una salchicha long, filete de pechuga en trocitos, queso costeño y mozzarella";
          else if (cat.name.includes("Hamburguesas")) text = "Filete de pechuga a la parrilla y queso mozzarella";
          else if (cat.name.includes("Patacones") || cat.name.includes("Picadas") || cat.name.includes("Salchipapas")) text = "Filete de pechuga en trocitos";
          else if (cat.name.includes("Maicitos")) text = "Maíz tierno y pollo en trocitos";
        }
        if (text) {
          await prisma.menuItem.update({where: { id: item.id }, data: { description: text }});
          updatedCount++;
        }
      }
      else if (item.name.toUpperCase() === 'CON CERDO') {
        let text = "";
        if (item.categoryId) {
          const cat = await prisma.category.findUnique({where: {id: item.categoryId}});
          if (cat.name.includes("Maicitos")) text = "Maíz tierno y cerdo en trocitos";
          else text = "Cerdo magro en trocitos";
        }
        if (text) {
          await prisma.menuItem.update({where: { id: item.id }, data: { description: text }});
          updatedCount++;
        }
      }
      else if (item.name.toUpperCase() === 'CON RANCHERA') {
        let text = "";
        if (item.categoryId) {
          const cat = await prisma.category.findUnique({where: {id: item.categoryId}});
          if (cat.name.includes("Maicitos")) text = "Maíz tierno y ranchera";
          else text = "Salchicha ranchera premium";
        }
        if (text) {
          await prisma.menuItem.update({where: { id: item.id }, data: { description: text }});
          updatedCount++;
        }
      }
      else if (item.name.toUpperCase() === 'CON TOCINETA') {
        let text = "";
        if (item.categoryId) {
          const cat = await prisma.category.findUnique({where: {id: item.categoryId}});
          if (cat.name.includes("Pizza")) text = descriptions["CON TOCINETA"];
          else if (cat.name.includes("Perros")) text = "Una salchicha long, tocineta ahumada, queso costeño y mozzarella";
        }
        if (text) {
          await prisma.menuItem.update({where: { id: item.id }, data: { description: text }});
          updatedCount++;
        }
      }
    }
  }
  console.log(`Descripciones actualizadas: ${updatedCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
