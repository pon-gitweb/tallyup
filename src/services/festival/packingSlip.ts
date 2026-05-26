import * as Print from 'expo-print';

export interface PackingSlipProduct {
  productName: string;
  quantity: number;
  unit: string;
  casesCount: number;
  condition: string;
  photoRef: string | null;
}

export interface PackingSlipData {
  slipNumber: string;
  eventName: string;
  supplierName: string;
  palletNumber: number;
  totalPallets: number;
  date: string;
  products: PackingSlipProduct[];
  festivalContact: { name: string; phone: string };
  chepPallets: number | null;
  driverSignatureLine: boolean;
  notes: string | null;
}

export async function generatePackingSlipPDF(data: PackingSlipData): Promise<string> {
  const html = buildHtml(data);
  const { uri } = await Print.printToFileAsync({ html });
  return uri;
}

function buildHtml(data: PackingSlipData): string {
  const productRows = data.products.map(p => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${p.productName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.quantity} ${p.unit}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.casesCount} cases</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${p.condition}</td>
    </tr>
  `).join('');

  const chepSection = data.chepPallets != null ? `
    <div style="margin-top:20px;padding:12px;background:#f3f4f6;border-radius:8px;">
      <div style="font-weight:800;font-size:13px;color:#374151;margin-bottom:6px;">CHEP PALLETS</div>
      <div style="font-size:13px;color:#374151;">Returning: <strong>${data.chepPallets}</strong> CHEP pallets</div>
      ${data.festivalContact ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">Account holder: ${data.festivalContact.name}</div>` : ''}
    </div>
  ` : '';

  const sigSection = data.driverSignatureLine ? `
    <div style="margin-top:24px;padding:16px;border:1.5px solid #d1d5db;border-radius:8px;">
      <div style="font-weight:800;font-size:13px;color:#374151;margin-bottom:16px;">DRIVER CONFIRMATION</div>
      <div style="margin-bottom:16px;font-size:13px;color:#374151;">Name: <span style="display:inline-block;width:200px;border-bottom:1px solid #374151;"></span></div>
      <div style="margin-bottom:16px;font-size:13px;color:#374151;">Signature: <span style="display:inline-block;width:180px;border-bottom:1px solid #374151;"></span></div>
      <div style="font-size:13px;color:#374151;">Time: <span style="display:inline-block;width:140px;border-bottom:1px solid #374151;"></span></div>
    </div>
  ` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, Arial, sans-serif; margin: 0; padding: 24px; color: #0B132B; }
        .header { border-bottom: 3px solid #1b4f72; padding-bottom: 16px; margin-bottom: 20px; }
        .title { font-size: 22px; font-weight: 800; color: #1b4f72; margin-bottom: 4px; }
        .slip-number { font-size: 12px; color: #6b7280; margin-bottom: 12px; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 20px; }
        .meta-item label { font-size: 11px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; display: block; }
        .meta-item span { font-size: 14px; font-weight: 600; color: #0B132B; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        thead tr { background: #1b4f72; }
        thead th { padding: 10px 12px; color: #fff; font-size: 12px; font-weight: 700; text-align: left; }
        .footer { margin-top: 20px; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 12px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">RETURN PACKING SLIP</div>
        <div class="slip-number">Slip: ${data.slipNumber}</div>
      </div>

      <div class="meta-grid">
        <div class="meta-item"><label>Event</label><span>${data.eventName}</span></div>
        <div class="meta-item"><label>Return to</label><span>${data.supplierName}</span></div>
        <div class="meta-item"><label>Pallet</label><span>${data.palletNumber} of ${data.totalPallets}</span></div>
        <div class="meta-item"><label>Date</label><span>${data.date}</span></div>
      </div>

      <div style="font-weight:800;font-size:13px;color:#374151;margin-bottom:8px;">CONTENTS</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th style="text-align:center;">Quantity</th>
            <th style="text-align:center;">Cases</th>
            <th style="text-align:center;">Condition</th>
          </tr>
        </thead>
        <tbody>${productRows}</tbody>
      </table>

      ${data.notes ? `<div style="margin-top:12px;padding:10px;background:#fef9c3;border-radius:6px;font-size:12px;color:#374151;">Notes: ${data.notes}</div>` : ''}

      <div style="margin-top:16px;padding:12px;background:#f3f4f6;border-radius:8px;font-size:13px;color:#374151;">
        Festival contact: <strong>${data.festivalContact.name}</strong> · ${data.festivalContact.phone}
      </div>

      ${chepSection}
      ${sigSection}

      <div class="footer">Generated by Hosti Festival · ${data.date}</div>
    </body>
    </html>
  `;
}
