// Reading a barcode from the camera (S12). The browser's own BarcodeDetector where it has one;
// otherwise the ZXing ponyfill, loaded only when the scan screen opens, with its WebAssembly served
// from this app rather than a CDN.

/** The retail codes on Japanese packaging: JAN is EAN-13 or EAN-8; imports carry UPC. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

type NativeDetector = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats: () => Promise<string[]>;
};

function nativeDetector(): NativeDetector | undefined {
  const candidate: unknown = Reflect.get(globalThis, 'BarcodeDetector');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Barcode Detection API's shape
  return typeof candidate === 'function' ? (candidate as NativeDetector) : undefined;
}

export async function barcodeDetector(): Promise<Detector> {
  const native = nativeDetector();
  if (native !== undefined) {
    const supported = await native.getSupportedFormats().catch((): string[] => []);
    if (FORMATS.some((format) => supported.includes(format))) {
      return new native({ formats: FORMATS.filter((format) => supported.includes(format)) });
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]);
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
  });
  return new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
}

/** A code as the API takes it: 8 to 14 digits. */
export const isBarcode = (text: string) => /^\d{8,14}$/.test(text);

/** `4 902102 141109`: an EAN-13 grouped as printed under the bars, for reading back. */
export const spacedBarcode = (code: string) =>
  code.length === 13 ? `${code.slice(0, 1)} ${code.slice(1, 7)} ${code.slice(7)}` : code;
