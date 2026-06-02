// Client-side type exports for AI prediction refinement.
// The full context builder + prompt builder live in
// functions/src/predictionRefinement.ts (server-side, Admin SDK).

export interface AiAdjustment {
  productName: string;
  category: string;
  adjustedShare: number;
  reasoning: string;
  confidenceInAdjustment: "high" | "medium" | "low";
}

export interface AiRefinement {
  adjustments: AiAdjustment[];
  categoryNotes: Record<string, string | null>;
  overallConfidence: "high" | "medium" | "low";
  historyUsed: boolean;
  adjustmentNote: string;
}
