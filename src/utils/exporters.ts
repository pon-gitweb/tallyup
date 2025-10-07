/**
 * CSV & PDF exporters (Expo-safe via dynamic imports).
 * - exportCsv(filename, headers[], rows[][])
 * - exportPdf(title, html)
 */
export async function exportCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  try {
    const FileSystem = await import('expo-file-system');
    const Sharing = await import('expo-sharing');

    const csv = [
      headers.join(','),
      ...rows.map(r =>
        r
          .map(cell => {
            if (cell == null) return '';
            const s = String(cell);
            const needsWrap = /[",\n]/.test(s);
            const escaped = '"' + s.replace(/"/g, '""') + '"';
            return needsWrap ? escaped : s;
          })
          .join(',')
      ),
    ].join('\n');

    const baseDir =
      (FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '') as string;
    const path = `${baseDir}${filename}`;

    await FileSystem.writeAsStringAsync(path, csv, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: 'text/csv',
        dialogTitle: 'Export CSV',
      });
    }

    return { ok: true, path };
  } catch (e) {
    if (__DEV__) console.log('[Export CSV] error', e);
    return { ok: false, error: e };
  }
}

export async function exportPdf(title: string, html: string) {
  try {
    const Print = await import('expo-print');
    const Sharing = await import('expo-sharing');

    const { uri } = await Print.printToFileAsync({ html, base64: false });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: title,
      });
    }

    return { ok: true, uri };
  } catch (e) {
    if (__DEV__) console.log('[Export PDF] error', e);
    return { ok: false, error: e };
  }
}
