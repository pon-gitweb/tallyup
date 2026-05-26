// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ContainerProduct {
  id: string;
  name: string;
  casesNeeded: number;
  caseWidthMM: number;
  caseLengthMM: number;
  caseHeightMM: number;
  velocityRank: number;          // 1 = fastest moving
  supplierContractual?: boolean; // must be accessible without moving other stock
}

export interface LayoutZone {
  id: 'front-left' | 'front-right' | 'mid-left' | 'mid-right' | 'back-left' | 'back-right';
  label: string;
  products: LayoutProductPlacement[];
  capacityCases: number;
  usedCases: number;
}

export interface LayoutProductPlacement {
  productId: string;
  productName: string;
  casesAssigned: number;
  stackingPattern: 'chasing5' | 'horizontal' | 'upright';
  stackHeight: number;
  casesWide: number;
  casesDeep: number;
}

export interface ContainerLayoutResult {
  zones: LayoutZone[];
  loadingOrder: { step: number; action: string; productName: string; cases: number }[];
  overflow: { productId: string; productName: string; overflowCases: number }[];
  guidance: string[];
  totalCapacityCases: number;
  totalAssignedCases: number;
}

// ─── Stacking patterns ────────────────────────────────────────────────────────

type StackPattern = 'chasing5' | 'horizontal' | 'upright';

function bestPattern(caseH: number, safeStackMM: number): StackPattern {
  // Chasing 5 (brick pattern on side) — best for cans/bottles, stable
  if (caseH <= 250 && safeStackMM / caseH >= 3) return 'chasing5';
  // Horizontal (on its side, labels up)
  if (caseH <= 350) return 'horizontal';
  return 'upright';
}

function stackLayers(pattern: StackPattern, caseH: number, caseLengthMM: number, safeStackMM: number): number {
  switch (pattern) {
    case 'chasing5':   return Math.floor(safeStackMM / caseLengthMM);
    case 'horizontal': return Math.floor(safeStackMM / caseH);
    case 'upright':    return Math.floor(safeStackMM / caseH);
    default:           return 1;
  }
}

// ─── Main function ────────────────────────────────────────────────────────────

export function calculateContainerLayout(
  container: { widthMM: number; lengthMM: number; heightMM: number; name: string },
  products: ContainerProduct[],
  aisleWidthMM: number = 800,
): ContainerLayoutResult {
  const { widthMM, lengthMM, heightMM } = container;
  const safeStackMM = Math.min(1600, heightMM - 200);
  const sideWidthMM = (widthMM - aisleWidthMM) / 2;

  if (sideWidthMM <= 0) {
    return {
      zones: [], loadingOrder: [], overflow: [],
      guidance: ['Container is too narrow for the specified aisle width.'],
      totalCapacityCases: 0, totalAssignedCases: 0,
    };
  }

  // Zone lengths: front 25%, mid 40%, back 35%
  const frontDepthMM = Math.round(lengthMM * 0.25);
  const midDepthMM   = Math.round(lengthMM * 0.40);
  const backDepthMM  = lengthMM - frontDepthMM - midDepthMM;

  // Sort products: contractual first, then fastest-moving
  const sorted = [...products].sort((a, b) => {
    if (a.supplierContractual && !b.supplierContractual) return -1;
    if (!a.supplierContractual && b.supplierContractual) return 1;
    return a.velocityRank - b.velocityRank;
  });

  // For each product, calculate how many cases fit in a zone slot
  function casesInZone(depthMM: number, product: ContainerProduct): { casesTotal: number; pattern: StackPattern; casesWide: number; casesDeep: number; stackHeight: number } {
    const pattern = bestPattern(product.caseHeightMM, safeStackMM);
    const casesWide = Math.floor(sideWidthMM / product.caseWidthMM);
    const casesDeep = Math.floor(depthMM / product.caseLengthMM);
    const layers    = stackLayers(pattern, product.caseHeightMM, product.caseLengthMM, safeStackMM);
    const casesTotal = casesWide * casesDeep * layers;
    const stackH = layers * (pattern === 'chasing5' ? product.caseLengthMM : product.caseHeightMM);
    return { casesTotal, pattern, casesWide, casesDeep, stackHeight: stackH };
  }

  const ZONE_DEFS: { id: LayoutZone['id']; label: string; depth: number }[] = [
    { id: 'front-left',  label: 'Front Left',  depth: frontDepthMM },
    { id: 'front-right', label: 'Front Right', depth: frontDepthMM },
    { id: 'mid-left',    label: 'Mid Left',    depth: midDepthMM },
    { id: 'mid-right',   label: 'Mid Right',   depth: midDepthMM },
    { id: 'back-left',   label: 'Back Left',   depth: backDepthMM },
    { id: 'back-right',  label: 'Back Right',  depth: backDepthMM },
  ];

  const zones: LayoutZone[] = ZONE_DEFS.map(z => ({
    id: z.id, label: z.label,
    products: [], capacityCases: 0, usedCases: 0,
  }));

  const overflow: ContainerLayoutResult['overflow'] = [];
  const remaining = sorted.map(p => ({ ...p, remaining: p.casesNeeded }));

  // Assign: fastest-moving to front (accessible), slower to back
  const zoneOrder: LayoutZone['id'][] = ['front-left', 'front-right', 'mid-left', 'mid-right', 'back-left', 'back-right'];

  for (const prod of remaining) {
    let leftToAssign = prod.remaining;
    for (const zoneId of zoneOrder) {
      if (leftToAssign <= 0) break;
      const zoneDef = ZONE_DEFS.find(z => z.id === zoneId)!;
      const zone = zones.find(z => z.id === zoneId)!;
      const { casesTotal, pattern, casesWide, casesDeep, stackHeight } = casesInZone(zoneDef.depth, prod);

      // Space remaining in zone
      const zoneRemaining = casesTotal - zone.usedCases;
      if (zoneRemaining <= 0) continue;

      const assign = Math.min(leftToAssign, zoneRemaining);
      zone.products.push({
        productId:       prod.id,
        productName:     prod.name,
        casesAssigned:   assign,
        stackingPattern: pattern,
        stackHeight,
        casesWide,
        casesDeep,
      });
      zone.usedCases += assign;
      zone.capacityCases = casesTotal;
      leftToAssign -= assign;
    }

    if (leftToAssign > 0) {
      overflow.push({ productId: prod.id, productName: prod.name, overflowCases: leftToAssign });
    }
  }

  // Loading order: back-to-front, slower-moving first
  const loadingOrder: ContainerLayoutResult['loadingOrder'] = [];
  let step = 1;
  for (const zoneId of ['back-left', 'back-right', 'mid-left', 'mid-right', 'front-left', 'front-right'] as LayoutZone['id'][]) {
    const zone = zones.find(z => z.id === zoneId)!;
    for (const p of zone.products) {
      loadingOrder.push({
        step: step++,
        action: `Load into ${zone.label}`,
        productName: p.productName,
        cases: p.casesAssigned,
      });
    }
  }

  // Plain-English guidance
  const guidance: string[] = [
    `Container: ${container.name}. Aisle width: ${aisleWidthMM}mm. Usable side width: ${Math.round(sideWidthMM)}mm each side.`,
    `Max safe stack height: ${safeStackMM}mm (${Math.round(safeStackMM / 1000 * 10) / 10}m).`,
    'Load back-to-front — slowest-moving products go in first.',
    'Fastest-moving products are in the front zones for quick access during the event.',
  ];
  if (overflow.length > 0) {
    guidance.push(`${overflow.length} product(s) could not fit in the container. See overflow list.`);
  }
  const contractualProds = sorted.filter(p => p.supplierContractual);
  if (contractualProds.length > 0) {
    guidance.push(`Supplier-contractual products (${contractualProds.map(p => p.name).join(', ')}) have been placed in front zones for guaranteed accessibility.`);
  }

  const totalCapacityCases = zones.reduce((s, z) => s + z.capacityCases, 0);
  const totalAssignedCases = zones.reduce((s, z) => s + z.usedCases, 0);

  return { zones, loadingOrder, overflow, guidance, totalCapacityCases, totalAssignedCases };
}
