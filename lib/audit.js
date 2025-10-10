const { EmbedBuilder } = require('discord.js');
const db = require('./db');

async function logAction(guild, caseId, action, author, details) {
  try {
    // persist in DB
    await db.addLog(caseId, action, author.id || author, author.tag || String(author), details);

    // send to audit channel
    if (!guild) return;
    const audit = guild.channels.cache.find(c => c.name === '🔒-activity-log');
    if (!audit) return;

    const embed = new EmbedBuilder()
      .setTitle('AUDIT LOG')
      .addFields(
        { name: 'Caso ID', value: String(caseId), inline: true },
        { name: 'Ação', value: action, inline: true },
        { name: 'Autor', value: `${author.displayName || author} (${author.id || ''})`, inline: false },
        { name: 'Detalhes', value: details || '—', inline: false }
      )
      .setTimestamp();

    audit.send({ embeds: [embed] }).catch(() => null);
  } catch (err) {
    console.error('audit.logAction error:', err);
  }
}

module.exports = { logAction };
