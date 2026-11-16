import { connectWhatsApp } from './connection.js';
import {
  handleLobby,
  handlePrivateNightMessage
} from './src/lobby.js';
import { handleSpyLobby, handleSpyPrivateMessage } from './src/spy/index.js';

function getText(message) {
  let content = message.message;

  while (
    content?.ephemeralMessage ||
    content?.viewOnceMessage ||
    content?.viewOnceMessageV2
  ) {
    content =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message;
  }

  return (
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    ''
  ).trim();
}

function getUniqueJids(...jids) {
  return [...new Set(jids.filter(Boolean))];
}

async function handleMessage(sock, message) {
  if (!message.message || message.key.fromMe) return;

  const key = message.key;
  const jid = key.remoteJid;

  if (!jid) return;

  const text = getText(message);
  const command = text.toLowerCase();

  // PESAN PRIBADI
  if (!jid.endsWith('@g.us')) {
    if (command.startsWith('.spy')) {
      const senderJids = getUniqueJids(jid, key.senderPn, key.senderLid);
      try {
        await handleSpyPrivateMessage(sock, senderJids, text);
      } catch (error) {
        console.error('[SPY PRIVATE ERROR]', error);
      }
      return;
    }

  if (command.startsWith('.ww')) {
      const senderJids = getUniqueJids(
        jid,
        key.senderPn,
        key.senderLid
      );

      try {
        await handlePrivateNightMessage(
          sock,
          senderJids,
          command
        );
      } catch (error) {
        console.error('[PRIVATE ERROR]', error);
      }
    }

    return;
  }

  // PESAN GRUP
  const senderJids = getUniqueJids(
    key.participant,
    key.participantPn,
    key.participantLid
  );

  const sender =
    key.participantPn ||
    key.participant ||
    key.participantLid;

  if (!sender) return;

  if (command === '.ping') {
    await sock.sendMessage(jid, {
      text: '🐺 PONG!\nWerewolf Multiplayer aktif!'
    });
    return;
  }

  if (text.toLowerCase().startsWith('.spy')) {
    try {
      await handleSpyLobby(sock, jid, sender, text, senderJids);
    } catch (error) {
      console.error('[SPY LOBBY ERROR]', error);
      await sock.sendMessage(jid, { text: '❌ Terjadi kesalahan pada sistem Who’s Spy.' });
    }
    return;
  }

  if (command.startsWith('.ww')) {
    try {
      await handleLobby(
        sock,
        jid,
        sender,
        command,
        senderJids
      );
    } catch (error) {
      console.error('[LOBBY ERROR]', error);

      await sock.sendMessage(jid, {
        text: '❌ Terjadi kesalahan pada sistem lobby.'
      });
    }
  }
}

console.log('🐺 Memulai Werewolf Multiplayer...');

connectWhatsApp(handleMessage);
