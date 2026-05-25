// @ts-nocheck
import type { FestivalVelocityData } from './festivalVelocity';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PlanogramShelf {
  id: 'top' | 'middle' | 'bottom' | 'door';
  label: string;
  positions: PlanogramPosition[];
  tempRangeC: { min: number; max: number };
}

export interface PlanogramPosition {
  slot: number;
  productId: string;
  productName: string;
  facings: number;
  reason: string;
  supplierRequirement: string | null;
  temperature: 'cold' | 'ambient' | 'any';
}

export interface PlanogramRequirementCheck {
  productId: string;
  productName: string;
  required: string;
  met: boolean;
}

export interface FridgePlanogram {
  shelves: PlanogramShelf[];
  requirementChecks: PlanogramRequirementCheck[];
  unplacedProducts: { productId: string; productName: string; reason: string }[];
}

// ─── Product category helpers ─────────────────────────────────────────────────

type Category = 'beer' | 'wine' | 'spirits' | 'rtd' | 'mixer' | 'water' | 'other';

function guessCategory(name: string): Category {
  const n = (name || '').toLowerCase();
  if (n.includes('beer') || n.includes('lager') || n.includes('ale') || n.includes('ipa')) return 'beer';
  if (n.includes('wine') || n.includes('sauvignon') || n.includes('pinot') || n.includes('rosé') || n.includes('rose')) return 'wine';
  if (n.includes('spirit') || n.includes('whisky') || n.includes('whiskey') || n.includes('vodka') || n.includes('rum') || n.includes('gin')) return 'spirits';
  if (n.includes('rtd') || n.includes('seltzer') || n.includes('hard') || n.includes('ready')) return 'rtd';
  if (n.includes('mixer') || n.includes('tonic') || n.includes('soda') || n.includes('juice') || n.includes('cola') || n.includes('ginger')) return 'mixer';
  if (n.includes('water')) return 'water';
  return 'other';
}

function categoryTempReq(cat: Category): 'cold' | 'ambient' | 'any' {
  switch (cat) {
    case 'beer':    return 'cold';
    case 'wine':    return 'cold';
    case 'rtd':     return 'cold';
    case 'water':   return 'cold';
    case 'mixer':   return 'ambient'; // door shelf ok
    case 'spirits': return 'ambient';
    default:        return 'any';
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

export function generatePlanogram(
  bar: { id: string; name: string; fridgeShelves?: number },
  products: { id: string; productName: string; currentStock: number; unit?: string; supplierRequirement?: string; brand?: string }[],
  velocityData: Record<string, FestivalVelocityData>,
): FridgePlanogram {
  const shelvesAvailable = bar.fridgeShelves ?? 3;

  // Define shelves
  const shelves: PlanogramShelf[] = [
    { id: 'top',    label: 'Top shelf',    positions: [], tempRangeC: { min: 2, max: 5 } },
    { id: 'middle', label: 'Middle shelf', positions: [], tempRangeC: { min: 2, max: 4 } },
    { id: 'bottom', label: 'Bottom shelf', positions: [], tempRangeC: { min: 1, max: 3 } },
    { id: 'door',   label: 'Door shelf',   positions: [], tempRangeC: { min: 4, max: 8 } },
  ].slice(0, shelvesAvailable + 1); // always include door shelf

  // Sort products by placement priority
  const sorted = [...products].sort((a, b) => {
    // 1. Contractual requirements first
    if (a.supplierRequirement && !b.supplierRequirement) return -1;
    if (!a.supplierRequirement && b.supplierRequirement) return 1;
    // 2. Fastest moving (lowest hours remaining = highest priority)
    const va = velocityData[a.id];
    const vb = velocityData[b.id];
    const ha = va?.hoursRemaining ?? 999;
    const hb = vb?.hoursRemaining ?? 999;
    return ha - hb;
  });

  const requirementChecks: PlanogramRequirementCheck[] = [];
  const unplacedProducts: FridgePlanogram['unplacedProducts'] = [];

  // Group by category for adjacency
  const byCategory: Record<Category, typeof sorted> = {
    beer: [], wine: [], rtd: [], spirits: [], mixer: [], water: [], other: [],
  };
  for (const p of sorted) {
    const cat = guessCategory(p.productName);
    byCategory[cat].push(p);
  }

  // Placement: contractual → middle shelf; fastest → middle; cold drinks → main shelves; mixers → door
  let slotCounter: Record<PlanogramShelf['id'], number> = { top: 0, middle: 0, bottom: 0, door: 0 };

  function placeProduct(
    shelfId: PlanogramShelf['id'],
    product: typeof sorted[0],
    reason: string,
  ) {
    const shelf = shelves.find(s => s.id === shelfId);
    if (!shelf) { unplacedProducts.push({ productId: product.id, productName: product.productName, reason: 'Shelf not available' }); return; }
    const slot = ++slotCounter[shelfId];
    const vd = velocityData[product.id];
    const facings = vd?.unitsPerHour != null && vd.unitsPerHour > 2 ? 3 : 2;
    shelf.positions.push({
      slot,
      productId:   product.id,
      productName: product.productName,
      facings,
      reason,
      supplierRequirement: product.supplierRequirement ?? null,
      temperature: categoryTempReq(guessCategory(product.productName)),
    });

    // Check supplier requirement
    if (product.supplierRequirement) {
      const required = product.supplierRequirement;
      const met = (shelfId === 'middle') ||
        (required.toLowerCase().includes('eye') && shelfId === 'middle') ||
        (required.toLowerCase().includes('front') && (shelfId === 'middle' || shelfId === 'top'));
      requirementChecks.push({ productId: product.id, productName: product.productName, required, met });
    }
  }

  const placed = new Set<string>();

  // Pass 1: Contractual items → middle shelf (eye level)
  for (const cat of ['beer', 'wine', 'rtd', 'spirits', 'mixer', 'water', 'other'] as Category[]) {
    for (const p of byCategory[cat]) {
      if (p.supplierRequirement && !placed.has(p.id)) {
        placeProduct('middle', p, 'Supplier contractual requirement — eye level');
        placed.add(p.id);
      }
    }
  }

  // Pass 2: Fastest-moving beer/RTD → middle shelf (if not already full)
  const fastCategories: Category[] = ['beer', 'rtd'];
  for (const cat of fastCategories) {
    for (const p of byCategory[cat]) {
      if (!placed.has(p.id)) {
        const vd = velocityData[p.id];
        const isFast = vd?.unitsPerHour != null && vd.unitsPerHour >= 1;
        if (isFast) {
          placeProduct(slotCounter.middle < 6 ? 'middle' : 'top', p, 'Fastest moving — front and centre');
          placed.add(p.id);
        }
      }
    }
  }

  // Pass 3: Remaining beer/RTD → top or bottom shelf
  for (const cat of fastCategories) {
    for (const p of byCategory[cat]) {
      if (!placed.has(p.id)) {
        placeProduct(slotCounter.top <= slotCounter.bottom ? 'top' : 'bottom', p, 'Beer/RTD — cold shelf');
        placed.add(p.id);
      }
    }
  }

  // Pass 4: Wine → top shelf (cold)
  for (const p of byCategory.wine) {
    if (!placed.has(p.id)) {
      placeProduct('top', p, 'Wine — cold storage');
      placed.add(p.id);
    }
  }

  // Pass 5: Mixers → door shelf (ambient ok, quick access)
  for (const p of byCategory.mixer) {
    if (!placed.has(p.id)) {
      placeProduct('door', p, 'Mixer — door shelf, quick access');
      placed.add(p.id);
    }
  }

  // Pass 6: Water → bottom shelf
  for (const p of byCategory.water) {
    if (!placed.has(p.id)) {
      placeProduct('bottom', p, 'Water — bottom shelf');
      placed.add(p.id);
    }
  }

  // Pass 7: Spirits → door or top shelf (cool, not critical to chill)
  for (const p of byCategory.spirits) {
    if (!placed.has(p.id)) {
      placeProduct(slotCounter.door < 4 ? 'door' : 'top', p, 'Spirits — cool shelf');
      placed.add(p.id);
    }
  }

  // Pass 8: Remaining → whatever fits
  for (const cat of Object.keys(byCategory) as Category[]) {
    for (const p of byCategory[cat]) {
      if (!placed.has(p.id)) {
        const shelf = Object.entries(slotCounter).sort(([, a], [, b]) => a - b)[0][0] as PlanogramShelf['id'];
        placeProduct(shelf, p, 'Placed to balance shelf load');
        placed.add(p.id);
      }
    }
  }

  return {
    shelves: shelves.filter(s => s.positions.length > 0 || s.id === 'door'),
    requirementChecks,
    unplacedProducts,
  };
}
