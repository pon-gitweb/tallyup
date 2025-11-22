import { getAuth } from 'firebase/auth';

/**
 * Call the Cloud Function to create a new venue owned by the currently signed-in user.
 *
 * Server behavior (createVenueOwnedByUser):
 *   - Verifies Firebase ID token from Authorization: Bearer <idToken>
 *   - Uses token.uid as the owner
 *   - Creates venues/{venueId}
 *   - Creates venues/{venueId}/members/{uid} with role "owner"
 *   - Sets users/{uid}.venueId = venueId
 *
 * Returns the generated venueId as a string.
 */
const FUNCTIONS_REGION = 'australia-southeast1';
const PROJECT_ID = process.env.EXPO_PUBLIC_FB_PROJECT_ID || 'tallyup-f1463';
const BASE_URL = `https://${FUNCTIONS_REGION}-${PROJECT_ID}.cloudfunctions.net`;

export async function createVenueOwnedByCurrentUser(name: string): Promise<string> {
  const auth = getAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error('Not signed in. Please log in before creating a venue.');
  }

  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    throw new Error('Venue name is required.');
  }

  // Get Firebase ID token to satisfy Authorization requirement
  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch (err: any) {
    console.log('[createVenueOwnedByCurrentUser] getIdToken error', err?.message);
    throw new Error('Could not obtain auth token. Please try signing in again.');
  }

  const url = `${BASE_URL}/createVenueOwnedByUser`;
  console.log('[createVenueOwnedByCurrentUser] calling URL', url);

  const payload = {
    // Server will mainly trust the token, but we still send the name explicitly
    name: trimmedName,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // This is what the function complained about previously
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    console.log('[createVenueOwnedByCurrentUser] network error', err?.message);
    throw new Error('Failed to reach the server. Check your connection and try again.');
  }

  if (!res.ok) {
    let bodyText: string | undefined;
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    console.log('[createVenueOwnedByCurrentUser] HTTP error', res.status, bodyText);

    if (res.status === 401 || res.status === 403) {
      throw new Error('You are not authorised to create a venue. Please sign in again and try once more.');
    }

    // If backend sends structured JSON { error: "..." }, try to surface that
    try {
      const maybeJson = bodyText ? JSON.parse(bodyText) : null;
      if (maybeJson && typeof maybeJson.error === 'string') {
        throw new Error(maybeJson.error);
      }
    } catch {
      // fall through
    }

    throw new Error(bodyText || `Server error (${res.status})`);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    console.log('[createVenueOwnedByCurrentUser] response not JSON');
  }

  const venueId = json?.venueId;
  if (!venueId || typeof venueId !== 'string') {
    console.log('[createVenueOwnedByCurrentUser] missing venueId in response', json);
    throw new Error('Server did not return a venue id.');
  }

  console.log('[createVenueOwnedByCurrentUser] success', { venueId });
  return venueId;
}
