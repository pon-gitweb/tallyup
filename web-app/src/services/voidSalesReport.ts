import { auth } from '../firebase'

const API = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api'

async function getToken(): Promise<string> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Not authenticated')
  return token
}

export type VoidSalesReportResult =
  | { ok: true; alreadyVoided: true }
  | { ok: true; alreadyVoided?: false; voidedAt: string; needsReenrich: true }

export async function voidSalesReport(
  venueId: string,
  reportId: string,
  reason: string,
): Promise<VoidSalesReportResult> {
  const token = await getToken()
  const res = await fetch(`${API}/sales-reports/void`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ venueId, reportId, reason }),
  })
  const data = await res.json()
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `Void failed (HTTP ${res.status})`)
  }
  return data as VoidSalesReportResult
}
