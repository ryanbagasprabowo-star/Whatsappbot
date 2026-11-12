import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';

import qrcode from 'qrcode-terminal';
import pino from 'pino';

export async function connectWhatsApp(onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Werewolf Multiplayer', 'Chrome', '1.0.0'],
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nSCAN QR CODE IN WHATSAPP:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'connecting') {
      console.log('Menghubungkan ke WhatsApp...');
    }

    if (connection === 'open') {
      console.log('================================');
      console.log('🐺 WEREWOLF MULTIPLAYER ONLINE');
      console.log('================================');
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode;

      console.log('Koneksi terputus:', statusCode);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('Sesi logout. Silakan login ulang.');
        return;
      }

      console.log('Mencoba menghubungkan kembali...');
      setTimeout(() => connectWhatsApp(onMessage), 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      try {
        await onMessage(sock, message);
      } catch (error) {
        console.error('Error pesan:', error);
      }
    }
  });

  return sock;
}
