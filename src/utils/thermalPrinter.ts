import type { Order } from '../types';

/**
 * Known BLE GATT Service UUIDs for 58mm Thermal Bluetooth Printers
 * (Xprinter, Rongta, Goojprt, MHT-P58, Munbyn, POS-58, Sunmi, ZJ-58 BLE, Nordic UART, ISSC)
 */
const THERMAL_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  '00001101-0000-1000-8000-00805f9b34fb',
  '00001800-0000-1000-8000-00805f9b34fb',
  '00001801-0000-1000-8000-00805f9b34fb',
  '0000180a-0000-1000-8000-00805f9b34fb',
];

export type PrinterTransportMode = 'bluetooth' | 'serial' | 'rawbt' | 'browser';

export interface BluetoothPrinterSession {
  device: any;
  characteristic: any;
  deviceName: string;
}

export interface SerialPrinterSession {
  port: any;
  deviceName: string;
  baudRate: number;
}

const LS_PRINTER_MODE_KEY = 'makarem_printer_mode_v1';

let activePrinterSession: BluetoothPrinterSession | null = null;
let activeSerialSession: SerialPrinterSession | null = null;
let rawbtModeEnabled =
  typeof localStorage !== 'undefined' && localStorage.getItem(LS_PRINTER_MODE_KEY) === 'rawbt';

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as any).bluetooth);
}

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean((navigator as any).serial);
}

export function isRunningInsideIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export function isRawBtModeEnabled(): boolean {
  return rawbtModeEnabled;
}

export function setRawBtModeEnabled(enabled: boolean): void {
  rawbtModeEnabled = enabled;
  try {
    if (enabled) {
      localStorage.setItem(LS_PRINTER_MODE_KEY, 'rawbt');
    } else if (localStorage.getItem(LS_PRINTER_MODE_KEY) === 'rawbt') {
      localStorage.removeItem(LS_PRINTER_MODE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function getActivePrinterTransport(): PrinterTransportMode {
  if (activePrinterSession?.device?.gatt?.connected && activePrinterSession.characteristic) {
    return 'bluetooth';
  }
  if (activeSerialSession?.port?.writable) {
    return 'serial';
  }
  if (rawbtModeEnabled) {
    return 'rawbt';
  }
  return 'browser';
}

export function getConnectedPrinterName(): string | null {
  if (activePrinterSession?.device?.gatt?.connected) {
    return activePrinterSession.deviceName;
  }
  if (activeSerialSession?.port?.writable) {
    return activeSerialSession.deviceName;
  }
  if (rawbtModeEnabled) {
    return 'Android RawBT (Classic BT 58mm)';
  }
  return null;
}

export function disconnectBluetoothPrinter(): void {
  try {
    if (activePrinterSession?.device?.gatt?.connected) {
      activePrinterSession.device.gatt.disconnect();
    }
  } catch {
    // ignore disconnect errors
  }
  try {
    if (activeSerialSession?.port?.close) {
      activeSerialSession.port.close().catch(() => null);
    }
  } catch {
    // ignore serial close errors
  }
  activePrinterSession = null;
  activeSerialSession = null;
  setRawBtModeEnabled(false);
}

/**
 * Connects via Web Bluetooth BLE to a 58mm Thermal Printer and caches the writable GATT characteristic.
 */
export async function connectBluetooth58mmPrinter(): Promise<string> {
  const nav = navigator as any;
  if (!nav?.bluetooth) {
    throw new Error(
      'Web Bluetooth is not supported in this browser. Open in Google Chrome on Android/Desktop, or connect via USB/COM Serial or Android RawBT.'
    );
  }

  let device: any;
  try {
    device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: THERMAL_PRINTER_SERVICES,
    });
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (err?.name === 'SecurityError' || msg.toLowerCase().includes('permissions policy')) {
      throw new Error(
        'Bluetooth scanning is blocked inside the embedded preview frame. Click "Open Full Admin Tab" to pair your Bluetooth printer directly.'
      );
    }
    if (err?.name === 'NotFoundError') {
      throw new Error(
        'No BLE printer selected/found. Note: Many 58mm printers (RPP02N, MTP-2, ZJ-58, POS-58) use Classic Bluetooth SPP, which does not show in Chrome BLE scan — use "USB / BT Serial COM" on PC or "Android RawBT Mode" on phone!'
      );
    }
    throw err;
  }

  const server = await device.gatt.connect();
  const services = await server.getPrimaryServices();

  let writeChar: any = null;
  for (const service of services) {
    try {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        if (ch.properties?.writeWithoutResponse || ch.properties?.write) {
          writeChar = ch;
          break;
        }
      }
      if (writeChar) break;
    } catch {
      // inspect next service
    }
  }

  if (!writeChar) {
    throw new Error(
      'Connected to Bluetooth device, but no ESC/POS writable GATT print characteristic was found. If this is a Classic Bluetooth SPP printer, use USB/BT Serial COM or Android RawBT mode.'
    );
  }

  device.addEventListener?.('gattserverdisconnected', () => {
    activePrinterSession = null;
  });

  const deviceName = device.name || '58mm BLE Thermal Printer';
  activePrinterSession = {
    device,
    characteristic: writeChar,
    deviceName,
  };
  setRawBtModeEnabled(false);

  try {
    localStorage.setItem('makarem_printer_name', deviceName);
  } catch {
    // ignore
  }

  return deviceName;
}

/**
 * Connects via Web Serial API (USB Thermal Printer OR Windows/Mac paired Classic Bluetooth COM port!).
 */
export async function connectSerial58mmPrinter(baudRate = 9600): Promise<string> {
  const nav = navigator as any;
  if (!nav?.serial) {
    throw new Error(
      'Web Serial is not supported on this device/browser. On Android phone, enable "Android RawBT Mode" for Classic Bluetooth 58mm printing.'
    );
  }

  let port: any;
  try {
    port = await nav.serial.requestPort();
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (err?.name === 'SecurityError' || msg.toLowerCase().includes('permissions policy')) {
      throw new Error(
        'Serial port access is blocked inside the preview frame. Open Admin in a standalone browser tab first.'
      );
    }
    throw err;
  }

  await port.open({ baudRate });
  const info = port.getInfo?.() || {};
  const label = info.usbProductId
    ? `58mm USB/Serial (${info.usbProductId})`
    : `58mm Serial COM (${baudRate})`;

  activeSerialSession = {
    port,
    deviceName: label,
    baudRate,
  };
  setRawBtModeEnabled(false);
  return label;
}

async function writeSerialEscPos(port: any, data: Uint8Array): Promise<void> {
  const writer = port.writable.getWriter();
  try {
    await writer.write(data);
  } finally {
    writer.releaseLock();
  }
}

async function writeBleChunks(characteristic: any, data: Uint8Array): Promise<void> {
  const CHUNK_SIZE = 64;
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE);
    if (characteristic.properties?.writeWithoutResponse) {
      await characteristic.writeValueWithoutResponse(chunk);
    } else {
      await characteristic.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 12));
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function sendViaAndroidRawBT(packet: Uint8Array): void {
  const base64 = uint8ToBase64(packet);
  const link = document.createElement('a');
  link.href = `rawbt:base64,${base64}`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => link.remove(), 500);
}

/**
 * Renders an order slip onto a 384px wide (58mm thermal) monochrome canvas and encodes it as
 * ESC/POS raster bitmap (`GS v 0`) so BOTH Arabic and English item names print cleanly!
 */
function buildOrderReceiptBitmapEscPos(order: Order, language: 'en' | 'ar' = 'ar'): Uint8Array {
  const width = 384; // Standard 58mm thermal head width = 384 dots (48 bytes/row)
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 1200;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';

  let y = 26;

  const drawCentered = (text: string, font: string, step = 28) => {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.fillText(text, width / 2, y);
    y += step;
  };

  const drawRow = (leftText: string, rightText: string, font = 'bold 18px sans-serif', step = 24) => {
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.fillText(leftText, 8, y);
    ctx.textAlign = 'right';
    ctx.fillText(rightText, width - 8, y);
    y += step;
  };

  const drawDivider = () => {
    ctx.fillRect(8, y - 10, width - 16, 2);
    y += 14;
  };

  drawCentered('MAKAREM AL-KHAIR MODERN', 'bold 21px sans-serif', 26);
  drawCentered('مكارم الخير الحديثة', 'bold 22px Cairo, sans-serif', 28);
  drawCentered('ONLINE ORDER SLIP (58mm)', 'bold 15px monospace', 22);
  drawDivider();

  drawRow('Order #:', order.orderNumber, 'bold 20px monospace', 26);
  drawRow('Date:', new Date(order.createdAt).toLocaleString(), '15px sans-serif', 22);
  if (order.customerCode) {
    drawRow('Cust ID:', `#${order.customerCode}`, 'bold 18px monospace', 24);
  }
  drawRow('Mobile:', order.customerPhone || '—', 'bold 18px monospace', 24);
  drawRow('Customer:', (order.customerName || '').slice(0, 22), '16px sans-serif', 24);
  drawRow('Pay Method:', order.paymentMethod.toUpperCase(), 'bold 16px monospace', 22);
  drawDivider();

  drawRow('ITEM', 'QTY / OMR', 'bold 15px monospace', 22);
  for (const item of order.items) {
    const label = language === 'ar' && item.arabicName ? item.arabicName : item.name;
    const shortLabel = label.length > 22 ? `${label.slice(0, 21)}..` : label;
    drawRow(shortLabel, `${item.quantity} x ${item.price.toFixed(3)}`, 'bold 16px Cairo, sans-serif', 22);
    if (item.arabicName && language === 'ar' && item.name) {
      ctx.font = '13px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(item.name.slice(0, 28), 12, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${item.total.toFixed(3)}`, width - 8, y);
      y += 20;
    } else {
      ctx.font = 'bold 15px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${item.total.toFixed(3)} OMR`, width - 8, y);
      y += 20;
    }
  }

  if (order.customNotes) {
    drawDivider();
    ctx.font = 'bold 15px Cairo, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Note: ${order.customNotes.slice(0, 34)}`, 8, y);
    y += 24;
  }

  drawDivider();
  drawRow('TOTAL:', `${order.totalAmount.toFixed(3)} OMR`, 'bold 24px monospace', 30);
  drawDivider();
  drawCentered('Final billing via Store POS', 'bold 15px sans-serif', 24);
  drawCentered('شكراً لتسوقكم معنا', 'bold 18px Cairo, sans-serif', 44);

  const finalHeight = Math.min(canvas.height, y + 20);
  const imgData = ctx.getImageData(0, 0, width, finalHeight);
  const bytesPerRow = width / 8; // 48

  // ESC @ (init) + GS v 0 m xL xH yL yH + bitmap + feed + cut
  const header = [
    0x1b,
    0x40, // Initialize printer
    0x1d,
    0x76,
    0x30,
    0x00,
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    finalHeight & 0xff,
    (finalHeight >> 8) & 0xff,
  ];

  const raster = new Uint8Array(bytesPerRow * finalHeight);
  for (let row = 0; row < finalHeight; row++) {
    for (let byteCol = 0; byteCol < bytesPerRow; byteCol++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = byteCol * 8 + bit;
        const idx = (row * width + px) * 4;
        const lum =
          0.299 * imgData.data[idx] +
          0.587 * imgData.data[idx + 1] +
          0.114 * imgData.data[idx + 2];
        if (lum < 150) {
          byteVal |= 1 << (7 - bit);
        }
      }
      raster[row * bytesPerRow + byteCol] = byteVal;
    }
  }

  const footer = [0x1b, 0x64, 0x04, 0x1d, 0x56, 0x01]; // Feed 4 lines + partial cut
  const packet = new Uint8Array(header.length + raster.length + footer.length);
  packet.set(header, 0);
  packet.set(raster, header.length);
  packet.set(footer, header.length + raster.length);
  return packet;
}

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fallback 58mm thermal browser print via hidden iframe with `@page { size: 58mm auto; }`
 */
export function printOrderVia58mmBrowserDialog(order: Order, language: 'en' | 'ar' = 'ar'): void {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const itemsHtml = order.items
    .map(
      (it) => `
      <tr>
        <td style="padding:3px 0;font-size:11px;">
          <div style="font-weight:700;">${escapeHtml(language === 'ar' && it.arabicName ? it.arabicName : it.name)}</div>
          <div style="font-size:10px;color:#444;">${it.quantity} x ${it.price.toFixed(3)}</div>
        </td>
        <td style="text-align:right;font-weight:700;font-size:11px;vertical-align:top;">${it.total.toFixed(3)}</td>
      </tr>`
    )
    .join('');

  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: 58mm auto; margin: 2mm; }
        body { width: 52mm; margin: 0 auto; font-family: 'Cairo', monospace, sans-serif; color: #000; }
        .c { text-align: center; }
        .hr { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
      </style>
    </head>
    <body>
      <div class="c">
        <div style="font-weight:900;font-size:13px;">MAKAREM AL-KHAIR</div>
        <div style="font-weight:800;font-size:13px;">مكارم الخير الحديثة</div>
        <div style="font-size:10px;">ONLINE ORDER SLIP</div>
      </div>
      <div class="hr"></div>
      <div style="font-size:11px;">
        <div><strong>Order:</strong> ${escapeHtml(order.orderNumber)}</div>
        <div><strong>Date:</strong> ${escapeHtml(new Date(order.createdAt).toLocaleString())}</div>
        ${order.customerCode ? `<div><strong>Cust ID:</strong> #${escapeHtml(order.customerCode)}</div>` : ''}
        <div><strong>Mobile:</strong> ${escapeHtml(order.customerPhone)}</div>
        <div><strong>Name:</strong> ${escapeHtml(order.customerName)}</div>
        <div><strong>Pay:</strong> ${escapeHtml(order.paymentMethod.toUpperCase())}</div>
      </div>
      <div class="hr"></div>
      <table>${itemsHtml}</table>
      ${order.customNotes ? `<div class="hr"></div><div style="font-size:10px;"><strong>Note:</strong> ${escapeHtml(order.customNotes)}</div>` : ''}
      <div class="hr"></div>
      <div style="display:flex;justify-content:space-between;font-weight:900;font-size:14px;">
        <span>TOTAL</span>
        <span>${order.totalAmount.toFixed(3)} OMR</span>
      </div>
      <div class="hr"></div>
      <div class="c" style="font-size:10px;">Final bill processed in Store POS</div>
    </body>
  </html>`;

  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 1500);
    }, 250);
  }
}

/**
 * Prints an order to the connected 58mm Bluetooth / Serial / RawBT printer,
 * or falls back cleanly to system 58mm thermal print dialog when requested.
 */
export async function printOrderTo58mmPrinter(
  order: Order,
  language: 'en' | 'ar' = 'ar',
  allowBrowserFallback = true
): Promise<PrinterTransportMode | 'skipped'> {
  if (activePrinterSession?.device?.gatt?.connected && activePrinterSession.characteristic) {
    const packet = buildOrderReceiptBitmapEscPos(order, language);
    await writeBleChunks(activePrinterSession.characteristic, packet);
    return 'bluetooth';
  }

  if (activeSerialSession?.port?.writable) {
    const packet = buildOrderReceiptBitmapEscPos(order, language);
    await writeSerialEscPos(activeSerialSession.port, packet);
    return 'serial';
  }

  if (rawbtModeEnabled) {
    const packet = buildOrderReceiptBitmapEscPos(order, language);
    sendViaAndroidRawBT(packet);
    return 'rawbt';
  }

  if (allowBrowserFallback) {
    printOrderVia58mmBrowserDialog(order, language);
    return 'browser';
  }

  return 'skipped';
}

export async function printTest58mmBluetoothSlip(): Promise<PrinterTransportMode> {
  const testOrder: Order = {
    id: 'test-print',
    orderNumber: 'MAK-TEST',
    orderType: 'ecommerce',
    customerCode: '001',
    customerName: 'Test Print',
    customerPhone: '72095796',
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    status: 'pending',
    items: [
      {
        id: '1',
        productId: '1',
        name: 'Pepsi 330ml',
        arabicName: 'بيبسي 330 مل',
        unit: 'pcs',
        price: 0.25,
        quantity: 2,
        total: 0.5,
      },
    ],
    subtotal: 0.5,
    tax: 0,
    totalAmount: 0.5,
    salesplaySyncStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (activePrinterSession?.device?.gatt?.connected && activePrinterSession.characteristic) {
    const packet = buildOrderReceiptBitmapEscPos(testOrder, 'ar');
    await writeBleChunks(activePrinterSession.characteristic, packet);
    return 'bluetooth';
  }

  if (activeSerialSession?.port?.writable) {
    const packet = buildOrderReceiptBitmapEscPos(testOrder, 'ar');
    await writeSerialEscPos(activeSerialSession.port, packet);
    return 'serial';
  }

  if (rawbtModeEnabled) {
    const packet = buildOrderReceiptBitmapEscPos(testOrder, 'ar');
    sendViaAndroidRawBT(packet);
    return 'rawbt';
  }

  printOrderVia58mmBrowserDialog(testOrder, 'ar');
  return 'browser';
}
