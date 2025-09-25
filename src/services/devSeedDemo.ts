import { db } from './firebase';
import { addDoc, collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Seeds:
 *  - Suppliers: Service Foods, Allied/Tasman Liquor
 *  - Products with par levels
 *  - Per-supplier prices under products/{id}/prices/{supplierId}
 * After seeding, Suggested Orders will choose the cheapest supplier per product.
 */
export async function seedDemoSuppliersAndProducts(venueId: string) {
  const now = serverTimestamp();

  // Suppliers
  const sfRef = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
    name: 'Service Foods',
    // Public contact references: hello@servicefoods.co.nz, OrdersAKL@servicefoods.co.nz
    // Source: servicefoods.co.nz/contact-us
    email: 'hello@servicefoods.co.nz',
    phone: '+64 9 258 5010',
    createdAt: now,
  });
  const sfId = sfRef.id;

  const tlRef = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
    name: 'Allied Liquor (Tasman Liquor)',
    // Public contact references: orders@tasmanliquor.co.nz
    // Source: alliedliquor.co.nz contact page
    email: 'orders@tasmanliquor.co.nz',
    phone: '+64 9 263 3910',
    createdAt: now,
  });
  const tlId = tlRef.id;

  // Products (simple food + beverage mix)
  const products = [
    { name: 'Lager 330ml', sku: 'BEER-LAG-330', unit: 'bottle', parLevel: 24, packSize: 24 },
    { name: 'Pilsner 500ml', sku: 'BEER-PIL-500', unit: 'bottle', parLevel: 12, packSize: 12 },
    { name: 'House Red 750ml', sku: 'WINE-RED-750', unit: 'bottle', parLevel: 6,  packSize: 6  },
    { name: 'Chicken Breast 2kg', sku: 'KIT-CHK-BRST', unit: 'kg',     parLevel: 8,  packSize: 1  },
    { name: 'Mozzarella 1kg',    sku: 'KIT-MOZ-1KG',  unit: 'kg',     parLevel: 5,  packSize: 1  },
  ];

  for (const p of products) {
    // Create product with neutral default supplier; prices will decide
    const pref = await addDoc(collection(db, 'venues', venueId, 'products'), {
      name: p.name,
      sku: p.sku,
      unit: p.unit,
      parLevel: p.parLevel,
      packSize: p.packSize,
      // Leave defaultSupplierId empty on purpose; the price list will drive cheapest choice
      defaultSupplierId: null,
      createdAt: now,
      updatedAt: now,
    });

    const pid = pref.id;

    // Price list: give each supplier a price; vary to make one cheapest per item
    // Beverage lines cheaper at Allied/Tasman; food lines cheaper at Service Foods
    const isBeverage = p.sku.startsWith('BEER') || p.sku.startsWith('WINE');

    const priceSF = isBeverage ? 3.20 : 8.80; // SF more expensive on bev, cheaper on food
    const priceTL = isBeverage ? 2.95 : 9.10; // TL cheaper on bev, pricier on food

    await setDoc(doc(db, 'venues', venueId, 'products', pid, 'prices', sfId), {
      unitCost: priceSF,
      packSize: p.packSize,
      createdAt: now,
    });

    await setDoc(doc(db, 'venues', venueId, 'products', pid, 'prices', tlId), {
      unitCost: priceTL,
      packSize: p.packSize,
      createdAt: now,
    });
  }

  return { suppliers: [sfId, tlId], count: products.length };
}
