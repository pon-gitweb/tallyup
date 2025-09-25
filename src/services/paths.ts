import { db } from './firebase';
import { collection, doc, CollectionReference, DocumentReference } from 'firebase/firestore';

// Master venue structure (names, expected, etc.)
export function departmentsCol(venueId: string): CollectionReference {
  return collection(db, 'venues', venueId, 'departments') as CollectionReference;
}
export function departmentDoc(venueId: string, departmentId: string): DocumentReference {
  return doc(db, 'venues', venueId, 'departments', departmentId);
}
export function areasCol(venueId: string, departmentId: string): CollectionReference {
  return collection(db, 'venues', venueId, 'departments', departmentId, 'areas') as CollectionReference;
}
export function areaDoc(venueId: string, departmentId: string, areaId: string): DocumentReference {
  return doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId);
}
export function areaItemsCol(venueId: string, departmentId: string, areaId: string): CollectionReference {
  return collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items') as CollectionReference;
}
export function areaItemDoc(venueId: string, departmentId: string, areaId: string, itemId: string): DocumentReference {
  return doc(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items', itemId);
}

// Session doc (allowed by rules)
export function sessionDoc(venueId: string, sessionId = 'current'): DocumentReference {
  return doc(db, 'venues', venueId, 'sessions', sessionId);
}
