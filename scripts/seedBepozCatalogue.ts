/**
 * seedBepozCatalogue.ts
 *
 * Seeds the Bepoz NZ hospitality product list into global_products.
 * Checks all barcode variants before writing — skips products that are already present.
 *
 * Run with:
 *   FIREBASE_PROJECT=tallyup-f1463 npx ts-node scripts/seedBepozCatalogue.ts
 *
 * Requires application default credentials or GOOGLE_APPLICATION_CREDENTIALS env var.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT || 'tallyup-f1463';
const db = new Firestore({ projectId: PROJECT_ID });

interface BepozProduct {
  name: string;
  barcodes: string[];
  category: string;
}

const BEPOZ_PRODUCTS: BepozProduct[] = [
  { name: 'Mount Gay XO', barcodes: ['3399501007804505'], category: 'Spirits' },
  { name: 'Mount Gay Eclipse', barcodes: ['3399501007122500'], category: 'Spirits' },
  { name: 'Mount Gay Eclipse 1L', barcodes: ['3399501007122302'], category: 'Spirits' },
  { name: 'Strange Nature Gin', barcodes: ['3679421906580006'], category: 'Spirits' },
  { name: 'Little Biddy Classic', barcodes: ['3679421905209052'], category: 'Spirits' },
  { name: 'Dancing Sands Dry Gin 44%', barcodes: ['3679421904304031'], category: 'Spirits' },
  { name: 'Murderers Bay White', barcodes: ['3399421904304024'], category: 'Spirits' },
  { name: 'Murderers Bay Aged Gold', barcodes: ['3399421904304000'], category: 'Spirits' },
  { name: 'Jumping Goat Whisky', barcodes: ['2949421904201071'], category: 'Spirits' },
  { name: 'Scapegrace Black', barcodes: ['3679421903387660'], category: 'Spirits' },
  { name: 'Scapegrace Dry Gin', barcodes: ['3679421903387233'], category: 'Spirits' },
  { name: 'Black Robin', barcodes: ['3679421902922510'], category: 'Spirits' },
  { name: 'Stolen Gold', barcodes: ['3399421902113369'], category: 'Spirits' },
  { name: 'Stolen Smoked', barcodes: ['3399421902113352'], category: 'Spirits' },
  { name: 'Stolen White', barcodes: ['3399421902113000'], category: 'Spirits' },
  { name: 'Ratu Signature', barcodes: ['3399421901704711'], category: 'Spirits' },
  { name: 'Ratu Spiced Rum', barcodes: ['3399421901704209'], category: 'Spirits' },
  { name: 'Ratu Dark Rum', barcodes: ['3399421901704186'], category: 'Spirits' },
  { name: 'The Source Gin', barcodes: ['3679421031350031'], category: 'Spirits' },
  { name: 'The Reid', barcodes: ['3879421031350017'], category: 'Spirits' },
  { name: '42 Below', barcodes: ['3879421012620207'], category: 'Spirits' },
  { name: 'MGC Dry Gin', barcodes: ['3679369999051518'], category: 'Spirits' },
  { name: 'Four Pillars Shiraz', barcodes: ['3679349749000249'], category: 'Spirits' },
  { name: 'Four Pillars Rare Dry', barcodes: ['3679349749000164'], category: 'Spirits' },
  { name: 'Wild Turkey', barcodes: ['3969343496003492', '721059867009'], category: 'Spirits' },
  { name: 'Wild Turkey 916', barcodes: ['3969343496003508'], category: 'Spirits' },
  { name: 'Nikka Yoichi 10YO', barcodes: ['4329329982021096'], category: 'Spirits' },
  { name: 'Nikka Coffey Grain', barcodes: ['4329329982020266'], category: 'Spirits' },
  { name: 'Canadian Club Spiced', barcodes: ['3969316417006339'], category: 'Spirits' },
  { name: 'Midori', barcodes: ['2949311803060230', '9311803060124'], category: 'Liqueurs' },
  { name: 'Monkey 47 Sloe', barcodes: ['3679311643012888'], category: 'Spirits' },
  { name: 'Monkey 47', barcodes: ['3679311643012871'], category: 'Spirits' },
  { name: "Pimm's No.1", barcodes: ['2949310495081844', '5010262100030'], category: 'Spirits' },
  { name: 'Johnnie Walker Red', barcodes: ['2949310495074129'], category: 'Spirits' },
  { name: 'Ketel One', barcodes: ['3878711566013701'], category: 'Spirits' },
  { name: 'Kahlua', barcodes: ['2947610594252162', '2947610594252155'], category: 'Liqueurs' },
  { name: 'Diplomatico Reserva Exclusiva', barcodes: ['3397594003620059'], category: 'Spirits' },
  { name: 'Don Julio Anejo', barcodes: ['355674545000865'], category: 'Spirits' },
  { name: 'Don Julio Reposado', barcodes: ['355674545000858'], category: 'Spirits' },
  { name: 'Don Julio Blanco', barcodes: ['355674545000841'], category: 'Spirits' },
  { name: 'Don Julio 1942', barcodes: ['355674545000117'], category: 'Spirits' },
  { name: 'Absolut', barcodes: ['3877312040017683', '7312040017034'], category: 'Spirits' },
  { name: 'Absolut Vanilla', barcodes: ['3877312040350100', '7312040060108'], category: 'Spirits' },
  { name: 'Absolut Raspberri', barcodes: ['3877312040350056'], category: 'Spirits' },
  { name: 'Absolut Elyx', barcodes: ['3877312040211517', '7312040217014'], category: 'Spirits' },
  { name: 'Absolut Citron', barcodes: ['3877312040090709'], category: 'Spirits' },
  { name: 'Absolut Watermelon', barcodes: ['3877312040552726'], category: 'Spirits' },
  { name: 'Absolut Grapefruit', barcodes: ['3877312040552153'], category: 'Spirits' },
  { name: 'Patron Silver', barcodes: ['355721733000739'], category: 'Spirits' },
  { name: 'Patron Anejo', barcodes: ['355721733000715'], category: 'Spirits' },
  { name: 'Belvedere', barcodes: ['3875901041003003'], category: 'Spirits' },
  { name: 'Zubrowka', barcodes: ['3875900343005296', '5900343003513'], category: 'Spirits' },
  { name: 'Jack Daniels', barcodes: ['3965099873021873', '082184045954'], category: 'Spirits' },
  { name: 'Woodford Reserve', barcodes: ['3965099873007617'], category: 'Spirits' },
  { name: 'The Botanist', barcodes: ['3675055807400596', '5055807400596'], category: 'Spirits' },
  { name: 'Hendricks', barcodes: ['3675010327755014'], category: 'Spirits' },
  { name: 'Sailor Jerry', barcodes: ['3395010327405223', '5010327405223'], category: 'Spirits' },
  { name: 'Glenfiddich 15YO', barcodes: ['4155010327115139'], category: 'Spirits' },
  { name: 'Monkey Shoulder', barcodes: ['2949010327105215', '5010327105215'], category: 'Spirits' },
  { name: 'Beefeater', barcodes: ['3675000329002193'], category: 'Spirits' },
  { name: 'Beefeater Pink', barcodes: ['3675000299605950'], category: 'Spirits' },
  { name: 'Beefeater 24', barcodes: ['3675000299605004', '5000299605004'], category: 'Spirits' },
  { name: 'Tanqueray', barcodes: ['3675000291020706'], category: 'Spirits' },
  { name: 'Tanqueray No.10', barcodes: ['3675000281020761'], category: 'Spirits' },
  { name: 'Johnnie Walker Black', barcodes: ['2949000267189604', '5000267189611'], category: 'Spirits' },
  { name: 'Johnnie Walker Blue Label', barcodes: ['2949000267115245'], category: 'Spirits' },
  { name: 'Jagermeister', barcodes: ['2944067700013743', '4067700013750'], category: 'Spirits' },
  { name: 'Cointreau', barcodes: ['2943035542004206'], category: 'Liqueurs' },
  { name: 'Grand Marnier', barcodes: ['2943018300000245'], category: 'Liqueurs' },
  { name: 'Baileys', barcodes: ['2945011013100156', '5011013925094'], category: 'Liqueurs' },
  { name: 'Jameson', barcodes: ['4115011007003005', '5011007003005'], category: 'Spirits' },
  { name: 'Grey Goose', barcodes: ['3875010677850100'], category: 'Spirits' },
  { name: 'Campari', barcodes: ['3485800004001106'], category: 'Spirits' },
  { name: 'Aperol', barcodes: ['2948002230000302'], category: 'Spirits' },
  { name: 'Disaronno Amaretto', barcodes: ['2948001110016303', '8001110171507'], category: 'Liqueurs' },
  { name: 'Frangelico', barcodes: ['2948004160660304'], category: 'Liqueurs' },
  { name: 'Chambord', barcodes: ['2948004027034491'], category: 'Liqueurs' },
  { name: 'Havana Club 3yo', barcodes: ['3398501110080231'], category: 'Spirits' },
  { name: 'Havana Club 7yo', barcodes: ['3398501110080439'], category: 'Spirits' },
  { name: 'Havana Club Especial', barcodes: ['3398501110080903', '8501110080927'], category: 'Spirits' },
  { name: 'Malibu Original', barcodes: ['2945010284100018'], category: 'Spirits' },
  { name: 'Buffalo Trace', barcodes: ['396080244009984'], category: 'Spirits' },
  { name: 'Makers Mark', barcodes: ['396085246500071'], category: 'Spirits' },
  { name: 'Jim Beam White', barcodes: ['396080686002499', '5010278101335'], category: 'Spirits' },
  { name: 'Jim Beam Black', barcodes: ['396080686003335'], category: 'Spirits' },
  { name: 'Angostura Bitters', barcodes: ['528075496002005'], category: 'Bitters' },
  { name: 'Angostura Orange Bitters', barcodes: ['528075496331075'], category: 'Bitters' },
  { name: 'Martell VS', barcodes: ['3323219820000078'], category: 'Spirits' },
  { name: 'Martell VSOP', barcodes: ['3323219820007527'], category: 'Spirits' },
  { name: 'Hennessy VS', barcodes: ['3323245990250203'], category: 'Spirits' },
  { name: 'Courvoisier VS', barcodes: ['3323049197110076'], category: 'Spirits' },
  { name: 'Courvoisier VSOP', barcodes: ['3323049197210776'], category: 'Spirits' },
  { name: 'Remy Martin VSOP', barcodes: ['3323024482270109'], category: 'Spirits' },
  { name: 'Plantation Dark', barcodes: ['3393460410524423'], category: 'Spirits' },
  { name: 'Plantation 3 Star White', barcodes: ['3393460410529053'], category: 'Spirits' },
  { name: 'Plantation Pineapple', barcodes: ['3393460410529862'], category: 'Spirits' },
  { name: 'Southern Comfort', barcodes: ['2941210000100269'], category: 'Spirits' },
  { name: 'Fireball Cinnamon Whiskey', barcodes: ['294088004023492'], category: 'Spirits' },
  { name: 'Titos Vodka', barcodes: ['387619947000419', '619947000112'], category: 'Spirits' },
  { name: 'Goslings Black Seal', barcodes: ['3395391338002060', '5391338002060'], category: 'Spirits' },
  { name: 'Appleton Signature', barcodes: ['3395024576189100'], category: 'Spirits' },
  { name: 'Bacardi White', barcodes: ['3395010677014205'], category: 'Spirits' },
  { name: 'Gin Mare', barcodes: ['3678411640011578', '8411640000459'], category: 'Spirits' },
  { name: 'Drambuie', barcodes: ['2945010391100703'], category: 'Liqueurs' },
  { name: 'St Germain Elderflower', barcodes: ['294080480004699'], category: 'Liqueurs' },
  { name: 'Chartreuse Green', barcodes: ['2943023480110356', '3023480110707'], category: 'Liqueurs' },
  { name: 'Chartreuse Yellow', barcodes: ['2943023480140704'], category: 'Liqueurs' },
  { name: 'Cherry Heering', barcodes: ['2947350041950103', '7350041950103'], category: 'Liqueurs' },
  { name: 'Monin Almond Orgeat', barcodes: ['5283052910056247'], category: 'Syrups' },
  { name: 'Monin Grenadine', barcodes: ['5283052910056254'], category: 'Syrups' },
  { name: 'Monin Vanilla Syrup', barcodes: ['5283052910056469'], category: 'Syrups' },
  { name: 'Monin Caramel', barcodes: ['5283052910510046'], category: 'Syrups' },
  { name: 'Monin Rose', barcodes: ['5283052910056391'], category: 'Syrups' },
  { name: 'Monin Coconut Syrup', barcodes: ['5283052910056322'], category: 'Syrups' },
  { name: 'Peychauds Bitters', barcodes: ['528088004190187'], category: 'Bitters' },
  { name: 'Fee Bros Orange Bitters', barcodes: ['528791863140513'], category: 'Bitters' },
  { name: 'Fee Bros Peach Bitters', barcodes: ['528791863140520'], category: 'Bitters' },
  { name: 'Fee Bros Rhubarb Bitters', barcodes: ['528791863140650'], category: 'Bitters' },
  { name: 'Fee Bros Cherry Bitters', barcodes: ['528791863140667'], category: 'Bitters' },
  { name: 'Lillet Blanc', barcodes: ['2943057230000253', '3057230000253'], category: 'Aperitifs' },
  { name: 'Lillet Rose', barcodes: ['2943057230000277'], category: 'Aperitifs' },
  { name: 'Dolin Rouge', barcodes: ['3485327451000381'], category: 'Vermouth' },
  { name: 'Dolin Dry', barcodes: ['3485327451000379'], category: 'Vermouth' },
  { name: 'Noilly Prat', barcodes: ['3485302301000359'], category: 'Vermouth' },
  { name: 'Martini Rosso', barcodes: ['3485800057004802'], category: 'Vermouth' },
  { name: 'Fernet Branca', barcodes: ['3485800440001027'], category: 'Amaro' },
  { name: 'Amaro Averna', barcodes: ['3485800040020378'], category: 'Amaro' },
  { name: 'Amaro Montenegro', barcodes: ['3485800033000174'], category: 'Amaro' },
  { name: 'Cynar', barcodes: ['3485800224000102'], category: 'Amaro' },
  { name: 'Ricard', barcodes: ['2943163937011000'], category: 'Spirits' },
  { name: 'Pernod', barcodes: ['2943047100090316'], category: 'Spirits' },
  { name: 'Licor 43', barcodes: ['2948410221110150'], category: 'Liqueurs' },
  { name: 'Kraken 700ml', barcodes: ['339811538018753'], category: 'Spirits' },
  { name: 'Kraken 1L', barcodes: ['339811538013055'], category: 'Spirits' },
  { name: 'Suntory Toki', barcodes: ['4324901777303553'], category: 'Spirits' },
  { name: 'Haku Vodka', barcodes: ['3874901777284920'], category: 'Spirits' },
  { name: 'Hibiki Harmony', barcodes: ['4324080686934035'], category: 'Spirits' },
  { name: 'Roku', barcodes: ['367080686976059', '4901777305359'], category: 'Spirits' },
  { name: 'Ki No Bi Dry Gin', barcodes: ['3674589633900025', '4589633900155'], category: 'Spirits' },
  { name: 'Ki No Bi Sei Dry Gin', barcodes: ['3674589633900179'], category: 'Spirits' },
  { name: 'Nikka Days', barcodes: ['4324904230054160'], category: 'Spirits' },
];

async function barcodeExistsInGlobal(barcodes: string[]): Promise<boolean> {
  const col = db.collection('global_products');
  for (const bc of barcodes) {
    const snap1 = await col.where('barcode', '==', bc).limit(1).get();
    if (!snap1.empty) return true;
    const snap2 = await col.where('barcodeNumber', '==', bc).limit(1).get();
    if (!snap2.empty) return true;
    // Also check the barcodes array field for multi-barcode docs
    const snap3 = await col.where('barcodes', 'array-contains', bc).limit(1).get();
    if (!snap3.empty) return true;
  }
  return false;
}

async function seed() {
  let added = 0;
  let skipped = 0;
  const col = db.collection('global_products');

  for (const product of BEPOZ_PRODUCTS) {
    const exists = await barcodeExistsInGlobal(product.barcodes);
    if (exists) {
      console.log(`Skipped: ${product.name} (barcode already in catalogue)`);
      skipped++;
      continue;
    }

    const primary = product.barcodes[0];
    await col.add({
      barcode: primary,
      barcodeNumber: primary,
      barcodes: product.barcodes,
      name: product.name,
      category: product.category,
      brand: null,
      size: null,
      abv: null,
      source: 'bepoz-catalogue',
      addedAt: FieldValue.serverTimestamp(),
      addedByVenue: 'hosti-seed',
      country: 'NZ',
    });

    console.log(`Added: ${product.name} (${product.barcodes.join(', ')})`);
    added++;
  }

  console.log(`\nDone — ${added} added, ${skipped} skipped`);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
