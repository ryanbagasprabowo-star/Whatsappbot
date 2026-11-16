import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/spy-words.json');
const games = new Map();
const norm = s => String(s || '').trim().toLocaleLowerCase('id-ID');
const clean = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 30);
const same = (a,b) => a && b && a.split('@')[0].split(':')[0] === b.split('@')[0].split(':')[0] && a.split('@').pop() === b.split('@').pop();
function readWords() {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(d) ? d : []; }
  catch (e) { if (e.code !== 'ENOENT') console.error('[SPY WORDS]', e); return []; }
}
function writeWords(d) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(file + '.tmp', JSON.stringify(d,null,2) + '\n');
  fs.renameSync(file + '.tmp', file);
}
async function admin(sock, group, senders) {
  const meta = await sock.groupMetadata(group);
  const list = Array.isArray(senders) ? senders : [senders];
  const p = meta.participants.find(x => list.some(j => same(j,x.id) || same(j,x.lid)));
  return p?.admin === 'admin' || p?.admin === 'superadmin';
}
const player = (g,j) => g.players.find(p => same(p.jid,j));
const aliveList = g => g.players.filter(p => p.alive);
const listText = g => g.players.map((p,i) => (i+1)+'. '+p.name+(p.alive?'':' (gugur)')).join('\n');

async function finish(sock, group, g) {
  const alive = aliveList(g);
  if (!alive.some(p => p.spy)) {
    await sock.sendMessage(group,{text:'🎉 WARGA MENANG! Spy ditemukan: '+g.players.find(p=>p.spy).name+'\nKata warga: '+g.pair.a});
    games.delete(group); return true;
  }
  if (alive.length <= 2) {
    g.guess = true;
    const spy = alive.find(p=>p.spy);
    await sock.sendMessage(group,{text:'🕵️ SPY MENANG! Spy mendapat satu kesempatan terakhir menebak kata warga melalui DM.'});
    try { await sock.sendMessage(spy.jid,{text:'Tebak kata warga dengan perintah .spy guess KATA'}); } catch(e) { console.error(e); }
    return true;
  }
  return false;
}
async function countVotes(sock,group,g) {
  const counts = new Map();
  for (const t of g.votes.values()) counts.set(t,(counts.get(t)||0)+1);
  const high = Math.max(0,...counts.values());
  const top = [...counts].filter(x=>x[1]===high);
  if (top.length !== 1) {
    g.votes.clear(); g.phase='clue'; g.round++;
    await sock.sendMessage(group,{text:'⚖️ Voting seri. Diskusi ronde '+g.round+' dimulai kembali.'});
    return;
  }
  const out = g.players.find(p=>p.jid===top[0][0]);
  out.alive=false;
  await sock.sendMessage(group,{text:'🗳️ '+out.name+' dieliminasi ('+high+' suara). Identitas: '+(out.spy?'SPY':'WARGA')+'\n\nPemain tersisa:\n'+listText(g)});
  if (await finish(sock,group,g)) return;
  g.votes.clear(); g.clues.clear(); g.phase='clue'; g.round++;
  await sock.sendMessage(group,{text:'💬 Ronde '+g.round+' dimulai. Kirim petunjuk dengan .spy clue ISI.'});
}

export async function handleSpyPrivateMessage(sock, senders, command) {
  const m = String(command||'').trim().match(/^\.spy\s+guess\s+([\s\S]+)$/i);
  if (!m) return false;
  for (const [group,g] of games) {
    if (!g.guess) continue;
    const spy = g.players.find(p=>p.spy);
    if (!spy || !senders.some(j=>same(j,spy.jid))) continue;
    const correct = norm(m[1])===norm(g.pair.a);
    await sock.sendMessage(group,{text:correct?'🏆 SPY MENANG MUTLAK! Tebakan benar: '+g.pair.a:'🏡 WARGA MENANG! Tebakan Spy salah. Kata warga: '+g.pair.a});
    games.delete(group); return true;
  }
  return false;
}

export async function handleSpyLobby(sock,group,sender,command,senderJids=[sender]) {
  const m=String(command||'').trim().match(/^\.spy(?:\s+([\s\S]*))?$/i);
  if(!m) return false;
  const rest=m[1]||'', action=(rest.match(/^(\S+)/)||[])[1]?.toLowerCase()||'', args=rest.slice(action.length).trim();
  const senders=[...new Set([sender,...(senderJids||[])].filter(Boolean))];
  if(!action||action==='help') {
    await sock.sendMessage(group,{text:'🕵️ WHO’S SPY\n\nPemain: .spy join NAMA, .spy leave, .spy players, .spy clue ISI, .spy vote NAMA\n\nAdmin: .spy papanda, .spy start, .spy next, .spy stop, .spy add KATA1 dan KATA2, .spy remove KATA1 dan KATA2, .spy words\n\nTebakan akhir Spy melalui DM: .spy guess KATA'});
    return true;
  }
  if(['admin','papanda','start','next','stop','add','remove','words'].includes(action)) {
    let ok=false;
    try { ok=await admin(sock,group,senders); } catch(e) { console.error(e); await sock.sendMessage(group,{text:'❌ Gagal memeriksa admin grup.'}); return true; }
    if(!ok) { await sock.sendMessage(group,{text:'⛔ Perintah ini hanya untuk admin grup.'}); return true; }
  }
  if(action==='admin') {
    await sock.sendMessage(group,{text:'🛠️ BANTUAN ADMIN WHO’S SPY\\n\\nLOBBY & PERMAINAN\\n.spy papanda — Membuka lobby baru\\n.spy start — Memulai permainan (minimal 5 pemain)\\n.spy next — Mengakhiri fase clue dan memulai voting\\n.spy stop — Menghentikan permainan\\n.spy words — Melihat daftar pasangan kata\\n\\nKELOLA KATA\\n.spy add KATA1 dan KATA2 — Menambahkan pasangan kata\\nContoh: .spy add Apple dan Buah Naga\\n.spy remove KATA1 dan KATA2 — Menghapus pasangan kata\\n\\nPEMAIN\\n.spy players — Melihat daftar pemain\\n.spy help — Bantuan umum\\n\\nCatatan: Semua perintah admin hanya dapat digunakan oleh admin grup.'});
    return true;
  }
  if(action==='words') {
    const d=readWords();
    await sock.sendMessage(group,{text:'📚 PASANGAN KATA ('+d.length+')\n'+d.map((p,i)=>(i+1)+'. '+p.a+' ↔ '+p.b).join('\n')});
    return true;
  }
  if(action==='add'||action==='remove') {
    const pair=args.match(/^([\s\S]+?)\s+dan\s+([\s\S]+)$/i);
    if(!pair) { await sock.sendMessage(group,{text:'Format: .spy '+action+' KATA1 dan KATA2\nContoh: .spy add Apple dan buah naga'}); return true; }
    const a=clean(pair[1]),b=clean(pair[2]);
    if(!a||!b||norm(a)===norm(b)) { await sock.sendMessage(group,{text:'❌ Kedua kata harus berbeda.'}); return true; }
    const d=readWords(),i=d.findIndex(p=>(norm(p.a)===norm(a)&&norm(p.b)===norm(b))||(norm(p.a)===norm(b)&&norm(p.b)===norm(a)));
    if(action==='add') {
      if(i>=0) { await sock.sendMessage(group,{text:'⚠️ Pasangan kata sudah ada.'}); return true; }
      d.push({a,b,category:'Tambahan'}); writeWords(d);
      await sock.sendMessage(group,{text:'✅ Ditambahkan: '+a+' ↔ '+b+'\nTotal pasangan: '+d.length});
    } else {
      if(i<0) { await sock.sendMessage(group,{text:'❌ Pasangan tidak ditemukan.'}); return true; }
      const removed=d.splice(i,1)[0]; writeWords(d);
      await sock.sendMessage(group,{text:'🗑️ Dihapus: '+removed.a+' ↔ '+removed.b});
    }
    return true;
  }
  if(action==='papanda') {
    if(games.has(group)) { await sock.sendMessage(group,{text:'⚠️ Lobby Who’s Spy sudah tersedia.'}); return true; }
    games.set(group,{status:'waiting',phase:'lobby',players:[],votes:new Map(),clues:new Set(),round:1});
    await sock.sendMessage(group,{text:'🕵️ PAPANDA WHO’S SPY 🐼\n\n5–20 PEMAIN\nMayoritas mendapat kata yang sama, satu Spy mendapat kata berbeda yang berkaitan.\n\nKetik .spy join NAMA untuk bergabung. Lihat daftar dengan .spy players.'});
    return true;
  }
  const g=games.get(group);
  if(!g) { await sock.sendMessage(group,{text:'❌ Belum ada lobby. Admin dapat membuka dengan .spy papanda.'}); return true; }
  if(action==='join') {
    if(g.status!=='waiting') { await sock.sendMessage(group,{text:'❌ Lobby sudah ditutup.'}); return true; }
    if(player(g,sender)) { await sock.sendMessage(group,{text:'⚠️ Kamu sudah bergabung.'}); return true; }
    const name=clean(args);
    if(!name||g.players.some(p=>norm(p.name)===norm(name))) { await sock.sendMessage(group,{text:'❌ Nama kosong atau sudah digunakan.'}); return true; }
    if(g.players.length>=20) { await sock.sendMessage(group,{text:'❌ Maksimal 20 pemain.'}); return true; }
    g.players.push({jid:sender,name,alive:true,spy:false});
    await sock.sendMessage(group,{text:'✅ '+name+' bergabung ('+g.players.length+'/20).'}); return true;
  }
  if(action==='leave') {
    if(g.status!=='waiting') { await sock.sendMessage(group,{text:'❌ Tidak bisa keluar setelah permainan dimulai.'}); return true; }
    const p=player(g,sender);
    if(!p) { await sock.sendMessage(group,{text:'Kamu belum bergabung.'}); return true; }
    g.players=g.players.filter(x=>x!==p); await sock.sendMessage(group,{text:'👋 '+p.name+' keluar.'}); return true;
  }
  if(action==='players') {
    await sock.sendMessage(group,{text:'🕵️ DAFTAR PEMAIN\n'+(g.players.length?listText(g):'Belum ada pemain.')+'\nJumlah: '+g.players.length+'/20\nStatus: '+g.status}); return true;
  }
  if(action==='start') {
    if(g.status!=='waiting') { await sock.sendMessage(group,{text:'⚠️ Game sudah dimulai.'}); return true; }
    if(g.players.length<5) { await sock.sendMessage(group,{text:'❌ Minimal 5 pemain.'}); return true; }
    const d=readWords();
    if(!d.length) { await sock.sendMessage(group,{text:'❌ Data kata kosong. Tambahkan dengan .spy add KATA1 dan KATA2.'}); return true; }
    g.pair=d[Math.floor(Math.random()*d.length)];
    g.players.forEach(p=>{p.spy=false;p.alive=true;});
    g.players[Math.floor(Math.random()*g.players.length)].spy=true;
    g.status='playing'; g.phase='clue'; g.round=1;
    const failed=[];
    for(const p of g.players) {
      try { await sock.sendMessage(p.jid,{text:p.spy?'🕵️ KAMU SPY!\nKata rahasia: '+g.pair.b+'\nKategori: '+(g.pair.category||'Umum'):'👥 KAMU WARGA!\nKata rahasia: '+g.pair.a+'\nKategori: '+(g.pair.category||'Umum')+'\nBerikan petunjuk tanpa menyebut kata langsung.'}); }
      catch(e) { failed.push(p.name); console.error('[SPY DM]',e); }
    }
    if(failed.length) {
      g.status='waiting';g.phase='lobby';g.players.forEach(p=>p.spy=false);delete g.pair;
      await sock.sendMessage(group,{text:'⚠️ DM gagal dikirim ke: '+failed.join(', ')+'. Minta mereka membuka chat bot, lalu coba .spy start lagi.'}); return true;
    }
    await sock.sendMessage(group,{text:'🎮 WHO’S SPY DIMULAI!\nKata sudah dikirim melalui DM.\nRonde 1: kirim petunjuk dengan .spy clue ISI.\nAdmin gunakan .spy next untuk voting.'}); return true;
  }
  if(action==='clue') {
    if(g.status!=='playing'||g.phase!=='clue') { await sock.sendMessage(group,{text:'❌ Bukan fase petunjuk.'}); return true; }
    const p=player(g,sender);
    if(!p||!p.alive) { await sock.sendMessage(group,{text:'❌ Hanya pemain hidup yang dapat memberi petunjuk.'}); return true; }
    if(!args||g.clues.has(p.jid)) { await sock.sendMessage(group,{text:'Petunjuk kosong atau kamu sudah memberi petunjuk ronde ini.'}); return true; }
    g.clues.add(p.jid); await sock.sendMessage(group,{text:'💬 PETUNJUK — '+p.name+'\n'+args}); return true;
  }
  if(action==='next') {
    if(g.status!=='playing'||g.phase!=='clue') { await sock.sendMessage(group,{text:'❌ Bukan fase petunjuk.'}); return true; }
    g.phase='voting';g.votes.clear();
    await sock.sendMessage(group,{text:'🗳️ VOTING DIMULAI!\nPilih pemain dengan .spy vote NAMA. Semua pemain hidup harus voting.'}); return true;
  }
  if(action==='vote') {
    if(g.status!=='playing'||g.phase!=='voting') { await sock.sendMessage(group,{text:'❌ Bukan fase voting.'}); return true; }
    const voter=player(g,sender),target=g.players.find(p=>p.alive&&norm(p.name)===norm(args));
    if(!voter||!voter.alive||!target||target===voter) { await sock.sendMessage(group,{text:'❌ Pemilih atau target tidak valid.'}); return true; }
    g.votes.set(voter.jid,target.jid);
    const total=aliveList(g).length;
    await sock.sendMessage(group,{text:'✅ Suara '+voter.name+' dicatat ('+g.votes.size+'/'+total+').'});
    if(g.votes.size>=total) await countVotes(sock,group,g);
    return true;
  }
  if(action==='stop') { games.delete(group);await sock.sendMessage(group,{text:'🛑 Who’s Spy dihentikan.'});return true; }
  await sock.sendMessage(group,{text:'Perintah tidak dikenal. Gunakan .spy help.'}); return true;
}
