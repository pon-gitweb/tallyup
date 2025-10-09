import { getAuth } from 'firebase/auth';

const REGION = 'australia-southeast1';
const PROJECT = 'tallyup-f1463';
const ENDPOINT = `https://${REGION}-${PROJECT}.cloudfunctions.net/varianceDepartmentReport`;

export type VarianceRemoteParams = {
  venueId: string;
  departmentId?: string | null;
};

export type VarianceRemoteResponse = {
  ok: boolean;
  venueId: string;
  departmentId: string | null;
  shortages: any[];
  excesses: any[];
  totalShortageValue?: number;
  totalExcessValue?: number;
  notes?: any;
};

export async function fetchVarianceDepartment(
  { venueId, departmentId }: VarianceRemoteParams
): Promise<VarianceRemoteResponse> {
  if (!venueId) throw new Error('venueId is required');

  let token: string | undefined;
  try {
    const user = getAuth().currentUser;
    token = user ? await user.getIdToken() : undefined;
  } catch {
    // proceed without token
  }

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ venueId, departmentId: departmentId ?? undefined }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Remote variance failed (${resp.status}): ${text || resp.statusText}`);
  }

  return resp.json() as Promise<VarianceRemoteResponse>;
}
