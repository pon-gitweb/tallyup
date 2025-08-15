export type PhotoCountResult = { estimatedCount: number; confidence: number };

export async function analyzePhotoForCount(_imageUri: string): Promise<PhotoCountResult> {
  // TODO: integrate native vision / cloud function
  return Promise.resolve({ estimatedCount: 0, confidence: 0.0 });
}
