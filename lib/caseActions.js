const { ChannelType, EmbedBuilder } = require('discord.js');
const discordTranscripts = require('discord-html-transcripts');
const db = require('./db');
const audit = require('./audit');
const {
  parseParticipants,
  buildPanelMessage,
  updatePanelMessage,
} = require('./habilitationPanel');
const fs = require('fs');
const path = require('path');

let config = {};
try {
  config = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'config.json'))
  );
} catch (e) {}

async function escalateCase(caseRow, targetInstance, client, actor, options = {}) {
  try {
    const guild = config.guildId
      ? client.guilds.cache.get(config.guildId)
      : client.guilds.cache.first();
    if (!guild) throw new Error('Guild not available');

    const forumId =
      targetInstance === 1
        ? config.forums && config.forums.instance1
        : targetInstance === 2
        ? config.forums && config.forums.instance2
        : config.forums && config.forums.instance3;
    const destForum = forumId ? guild.channels.cache.get(forumId) : null;
    if (!destForum)
      throw new Error(
        `Canal de instância destino não encontrado (id: ${forumId})`
      );

    const previousInstance = caseRow.instance || 1;
    const currentParticipants = parseParticipants(caseRow.participants);
    const participantsForNextInstance = { ...currentParticipants };
    delete participantsForNextInstance.judge;

    const title = `${caseRow.case_number} — ${
      caseRow.title || 'Sem título'
    }`.slice(0, 100);

    const panelPayload = {
      ...caseRow,
      instance: targetInstance,
      participants: participantsForNextInstance,
    };
    const panelMessage = buildPanelMessage(panelPayload);

    const newThread = await destForum.threads
      .create({
        name: title,
        message: panelMessage,
        type: ChannelType.PublicThread,
      })
      .catch((err) => {
        throw err;
      });

    await newThread.permissionOverwrites
      .edit(newThread.guild.roles.everyone, { SendMessages: false })
      .catch(() => null);

    let oldThread = null;
    let transcriptAttachment = null;
    if (caseRow.thread_id) {
      oldThread = await client.channels
        .fetch(String(caseRow.thread_id))
        .catch(() => null);
      if (oldThread) {
        transcriptAttachment = await discordTranscripts
          .createTranscript(oldThread)
          .catch((err) => {
            console.error('Transcript generation failed:', err);
            return null;
          });
      }
    }

    const updated = await db.updateCase(caseRow.id, {
      instance: targetInstance,
      thread_id: String(newThread.id),
      participants: participantsForNextInstance,
    });

    const timeline = JSON.parse(updated.timeline || '[]');
    timeline.push({
      action: 'escalated',
      from: caseRow.instance,
      to: targetInstance,
      by: actor.id || actor,
      at: new Date().toISOString(),
    });
    await db.updateCase(caseRow.id, { timeline });
    await db.addLog(
      caseRow.id,
      'escalate',
      actor.id || actor,
      actor.tag || String(actor),
      `Escalonado para instância ${targetInstance}`
    );

    await audit.logAction(
      guild,
      caseRow.id,
      'escalate',
      actor,
      `Escalonado de ${caseRow.instance} para ${targetInstance}`
    );

    await updatePanelMessage(newThread, {
      ...updated,
      participants: participantsForNextInstance,
      instance: targetInstance,
    });

    const actorMention =
      typeof actor === 'object' && actor.id
        ? `<@${actor.id}>`
        : typeof actor === 'string'
        ? actor
        : null;

    const transferMessage =
      options.customMessage ||
      (`🔁 Este processo foi migrado da ${previousInstance}ª instância para a ${targetInstance}ª instância.\n` +
        'Os advogados permanecem habilitados automaticamente; o Juiz da nova instância deve se habilitar através do painel acima.' +
        (options.includeActorMention && actorMention
          ? `\nResponsável: ${actorMention}`
          : ''));

    if (transcriptAttachment) {
      await newThread
        .send({
          content: `${transferMessage}\n\nSegue o histórico completo da instância anterior em anexo.`,
          files: [transcriptAttachment],
        })
        .catch(() => null);
    } else {
      await newThread.send({ content: transferMessage }).catch(() => null);
    }

    if (oldThread) {
      await oldThread.delete().catch(() => null);
    }

    const publicChannel =
      config.channels && config.channels.movements
        ? guild.channels.cache.get(config.channels.movements)
        : null;
    if (publicChannel) {
      const b = new EmbedBuilder()
        .setTitle('Movimentação: Escalonamento')
        .setDescription(
          `${caseRow.case_number} movido da instância ${previousInstance} para a instância ${targetInstance}`
        )
        .addFields({ name: 'Instância', value: `${targetInstance}ª`, inline: true })
        .setTimestamp();
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
