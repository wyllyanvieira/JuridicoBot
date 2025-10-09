const db = require('./db');

// Mantém timeouts em memória
const scheduled = new Map();

function msUntil(date) {
  return new Date(date).getTime() - Date.now();
}

async function scheduleHearing(client, hearingRow) {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  const caseRow = await db.get('SELECT * FROM cases WHERE id = ?', [hearingRow.case_id]);
  if (!caseRow) return;

  const threadId = caseRow.thread_id;
  const thread = guild.channels.cache.get(String(threadId));

  const when = new Date(hearingRow.hearing_at);

  // 24h reminder
  const at24 = when.getTime() - (24 * 60 * 60 * 1000);
  const delay24 = at24 - Date.now();
  if (delay24 > 0) {
    const id = `h24_${hearingRow.id}`;
    const t = setTimeout(() => {
      const msg = `🔔 Lembrete: audiência de ${caseRow.case_number} em 24h (${when.toLocaleString()})`;
      if (thread) thread.send(msg).catch(()=>null);
      const userIds = []; // poderíamos notificar participantes
      for (const u of userIds) {
        guild.members.fetch(u).then(m => m.send(msg).catch(()=>null)).catch(()=>null);
      }
      scheduled.delete(id);
    }, delay24);
    scheduled.set(id, t);
  }

  // 1h reminder
  const at1 = when.getTime() - (1 * 60 * 60 * 1000);
  const delay1 = at1 - Date.now();
  if (delay1 > 0) {
    const id = `h1_${hearingRow.id}`;
    const t = setTimeout(() => {
      const msg = `🔔 Lembrete: audiência de ${caseRow.case_number} em 1h (${when.toLocaleString()})`;
      if (thread) thread.send(msg).catch(()=>null);
      scheduled.delete(id);
    }, delay1);
    scheduled.set(id, t);
  }
}

async function start(client) {
  // load upcoming hearings and schedule
  const rows = await db.all('SELECT * FROM hearings WHERE datetime(hearing_at) > datetime(?)', [new Date().toISOString()]);
  for (const r of rows) {
    scheduleHearing(client, r).catch(()=>null);
  }
}

module.exports = { start, scheduleHearing };
