import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";

// Canonical slug: lowercase, alphanumeric + underscores
function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

const SEED: Array<{
  name: string; phone?: string; email?: string; website?: string; category: string;
}> = [
  { name: "Gilmours",                          phone: "0800 454 657", website: "https://www.gilmours.co.nz",                       category: "food_beverage" },
  { name: "Bidfresh",                          phone: "0800 243 373", website: "https://www.bidfresh.co.nz",                       category: "food_beverage" },
  { name: "Hancocks Wine & Spirits",           phone: "0800 426 226", website: "https://hancocks.co.nz",                           category: "liquor"        },
  { name: "Lion New Zealand",                  phone: "+64 9 358 9000", website: "https://www.lion.co.nz",                         category: "liquor"        },
  { name: "DB Breweries",                      phone: "+64 9 579 6400", website: "https://www.dbbreweries.co.nz",                  category: "liquor"        },
  { name: "Pernod Ricard Winemakers NZ",       phone: "+64 9 309 0509", website: "https://www.pernod-ricard-nzwinemakers.com",    category: "liquor"        },
  { name: "Coca-Cola Europacific Partners NZ", phone: "0800 462 653",  website: "https://www.ccep.com/en-nz",                      category: "beverage"      },
  { name: "Bidfood New Zealand",               phone: "0800 243 363",  website: "https://www.bidfood.co.nz",                       category: "food_beverage" },
  { name: "Fresh Direct",                      phone: "+64 9 578 1234", website: "https://www.freshdirect.co.nz",                  category: "food_beverage" },
  { name: "Service Foods",                     phone: "0800 737 838",  website: "https://www.servicefoods.co.nz",                  category: "food_beverage" },
  { name: "Countrywide",                                               website: "https://countrywide.co.nz",                       category: "food_beverage" },
  { name: "Neat Meat",                         phone: "+64 9 274 2344", website: "https://www.neatmeat.co.nz",                    category: "food_beverage" },
  { name: "Open Country Dairy",                phone: "+64 7 884 6900", website: "https://www.openctry.com",                      category: "food_beverage" },
];

// Called once by an admin to populate the directory.
// Safe to re-run: uses set({ merge: true }) so it won't overwrite user-contributed data.
export const seedGlobalSuppliers = functions
  .region("us-central1")
  .https.onCall(async (_data, context) => {
    if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    const db = admin.firestore();
    let added = 0;
    for (const s of SEED) {
      const slug = toSlug(s.name);
      const ref = db.doc(`global_suppliers/${slug}`);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          name: s.name,
          phone: s.phone ?? null,
          email: s.email ?? null,
          website: s.website ?? null,
          category: s.category,
          isVerified: true,
          source: "seed",
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        added++;
      }
    }
    console.log("[seedGlobalSuppliers] seeded", added, "of", SEED.length);
    return { ok: true, added, total: SEED.length };
  });

// Contribute a supplier discovered from an invoice scan.
// Non-blocking — caller should .catch(() => {}).
// Never writes accountNumber, pricing, or private fields.
export async function contributeToGlobalDirectory(
  db: admin.firestore.Firestore,
  supplierName: string,
  details: { phone?: string | null; email?: string | null; address?: string | null; addedByVenue?: string }
): Promise<void> {
  if (!supplierName?.trim()) return;
  const slug = toSlug(supplierName.trim());
  if (!slug) return;

  const ref = db.doc(`global_suppliers/${slug}`);
  const snap = await ref.get();

  if (!snap.exists) {
    await ref.set({
      name: supplierName.trim(),
      phone: details.phone ?? null,
      email: details.email ?? null,
      address: details.address ?? null,
      isVerified: false,
      source: "invoice_scan",
      addedByVenue: details.addedByVenue ?? null,
      addedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    // Only fill in empty fields — never overwrite existing data
    const existing = snap.data() as any;
    const updates: Record<string, any> = {};
    if (!existing.phone && details.phone) updates.phone = details.phone;
    if (!existing.email && details.email) updates.email = details.email;
    if (!existing.address && details.address) updates.address = details.address;
    if (Object.keys(updates).length) {
      updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
      await ref.update(updates);
    }
  }
}
