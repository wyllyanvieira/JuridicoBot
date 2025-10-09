const { ChannelType, EmbedBuilder } = require('discord.js');
const db = require('./db');
const audit = require('./audit');
const fs = require('fs');
const path = require('path');
let config = {};
try { config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'))); } catch (e) {}

async function escalateCase(caseRow, targetInstance, client, actor) {
  try {
    const guild = config.guildId ? client.guilds.cache.get(config.guildId) : client.guilds.cache.first();
    if (!guild) throw new Error('Guild not available');

    // resolve forum channel id for instance
    const forumId = targetInstance === 1 ? (config.forums && config.forums.instance1) : targetInstance === 2 ? (config.forums && config.forums.instance2) : (config.forums && config.forums.instance3);
    const destForum = forumId ? guild.channels.cache.get(forumId) : null;
    if (!destForum) throw new Error(`Canal de instância destino não encontrado (id: ${forumId})`);

    // recreate topic in destination
    const title = `${caseRow.case_number} — ${caseRow.title || 'Sem título'}`;
    const newThread = await destForum.threads.create({ name: title, type: ChannelType.PublicThread }).catch(err => { throw err; });

    // post embed initial (try to use available buildCaseEmbed if exists)
    try {
      const { buildCaseEmbed } = require('../Templates/caseEmbed');
      const embed = buildCaseEmbed(Object.assign(caseRow, { thread_id: newThread.id }));
      await newThread.send({ embeds: [embed] }).catch(() => null);
    } catch (e) {
      await newThread.send(`${caseRow.case_number} movido para nova instância`).catch(() => null);
    }

    // close old thread if exists
    if (caseRow.thread_id) {
      const oldThread = guild.channels.cache.get(String(caseRow.thread_id));
      if (oldThread) {
        await oldThread.send(`Este processo foi transferido para <#${newThread.id}>`).catch(() => null);
        await oldThread.setLocked(true).catch(() => null);
        await oldThread.setArchived(true).catch(() => null);
      }
    }

    // update DB
    const updated = await db.updateCase(caseRow.id, { instance: targetInstance, thread_id: String(newThread.id) });

    // add timeline and log
    const timeline = JSON.parse(updated.timeline || '[]');
    timeline.push({ action: 'escalated', from: caseRow.instance, to: targetInstance, by: actor.id || actor, at: new Date().toISOString() });
    await db.updateCase(caseRow.id, { timeline });
    await db.addLog(caseRow.id, 'escalate', actor.id || actor, actor.tag || String(actor), `Escalonado para instância ${targetInstance}`);

    // audit channel
    await audit.logAction(guild, caseRow.id, 'escalate', actor, `Escalonado de ${caseRow.instance} para ${targetInstance}`);

    // public movement channel using config
    const publicChannel = config.channels && config.channels.movements ? guild.channels.cache.get(config.channels.movements) : null;
    if (publicChannel) {
      const b = new EmbedBuilder().setTitle('Movimentação: Escalonamento').setDescription(`${caseRow.case_number} movido para instância ${targetInstance}`).addFields({ name: 'Instância', value: `${targetInstance}ª`, inline: true }).setTimestamp();
      b.addFields({ name: 'Link', value: `https://discord.com/channels/${guild.id}/${newThread.id}` });
      publicChannel.send({ embeds: [b] }).catch(() => null);
    }

    return updated;
  } catch (err) {
    console.error('escalateCase error:', err);
    throw err;
  }
}

module.exports = { escalateCase };
