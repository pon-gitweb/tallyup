// @ts-nocheck
import { Linking } from 'react-native';
import * as Sharing from 'expo-sharing';

export interface ReturnProduct {
  productName: string;
  quantity: number;
  unit: string;
  condition: string;
}

export interface ReturnEmailData {
  supplierName: string;
  supplierEmail: string;
  eventName: string;
  eventDate: string;
  products: ReturnProduct[];
  packingSlips: string[];
  chepPallets: number | null;
  collectionDate: string;
  festivalContact: { name: string; phone: string };
  adminName: string;
}

export async function sendReturnEmail(data: ReturnEmailData): Promise<void> {
  // Share each packing slip PDF so user can attach from Files
  for (const uri of data.packingSlips) {
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Share packing slip for ${data.supplierName}`,
      });
    }
  }

  // Open mail app with pre-filled subject and body
  const body = buildEmailBody(data);
  const subject = `Return advice — ${data.eventName} ${data.eventDate}`;
  const mailtoUrl = `mailto:${data.supplierEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  const supported = await Linking.canOpenURL(mailtoUrl);
  if (supported) {
    await Linking.openURL(mailtoUrl);
  }
}

function buildEmailBody(data: ReturnEmailData): string {
  const productLines = data.products
    .map(p => `  ${p.productName} × ${p.quantity} ${p.unit} — ${p.condition}`)
    .join('\n');

  const chepLine = data.chepPallets != null
    ? `CHEP Pallets: ${data.chepPallets}\n\n`
    : '';

  return [
    `Dear ${data.supplierName},`,
    '',
    `Please find our return advice for ${data.eventName} — ${data.eventDate}.`,
    '',
    'PRODUCTS FOR RETURN:',
    productLines,
    '',
    `Packing slips: ${data.packingSlips.length} slip${data.packingSlips.length !== 1 ? 's' : ''} (PDF — attached separately)`,
    chepLine.trim() ? chepLine.trim() : '',
    `Collection requested: ${data.collectionDate}`,
    `Contact: ${data.festivalContact.name} ${data.festivalContact.phone}`,
    '',
    'All products as documented with photo evidence available on request.',
    '',
    `Regards,`,
    data.adminName,
    data.eventName,
  ].filter(l => l !== null && l !== undefined).join('\n');
}
