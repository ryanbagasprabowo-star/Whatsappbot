import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const databaseDir = path.resolve(currentDir, '../database');
const databaseFile = path.join(databaseDir, 'werewolf.json');

const defaultData = {
  players: {},
  games: {},
  settings: {}
};

export async function loadDatabase() {
  await fs.mkdir(databaseDir, { recursive: true });

  try {
    const content = await fs.readFile(databaseFile, 'utf8');
    const data = JSON.parse(content);

    return {
      ...defaultData,
      ...data
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    await saveDatabase(defaultData);
    return { ...defaultData };
  }
}

export async function saveDatabase(data) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    throw new TypeError('Data database harus berupa object.');
  }

  await fs.mkdir(databaseDir, { recursive: true });

  const temporaryFile = `${databaseFile}.tmp`;

  await fs.writeFile(
    temporaryFile,
    JSON.stringify(data, null, 2),
    'utf8'
  );

  await fs.rename(temporaryFile, databaseFile);

  return true;
}

export async function updateDatabase(updater) {
  if (typeof updater !== 'function') {
    throw new TypeError('Updater harus berupa function.');
  }

  const data = await loadDatabase();
  const updatedData = await updater(data);

  await saveDatabase(updatedData ?? data);

  return updatedData ?? data;
}

export async function getPlayerData(playerJid) {
  const data = await loadDatabase();

  return data.players[playerJid] ?? null;
}

export async function savePlayerData(playerJid, playerData) {
  if (!playerJid || !playerData || typeof playerData !== 'object') {
    throw new TypeError('Data pemain tidak valid.');
  }

  return updateDatabase(data => {
    data.players[playerJid] = {
      ...(data.players[playerJid] || {}),
      ...playerData
    };

    return data;
  });
}
