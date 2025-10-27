export const norm = (s?: string | null) =>
  (s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normSize = (s?: string | null) =>
  (s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/litre|litres|ltr/g, 'l')
    .replace(/millilitres|millilitre/g, 'ml');
