const client = require('../index');

function loadConfig() {
  try {
    return require('../config.json');
  } catch (err) {
    return {};
  }
}

async function sendDebugMessage(interaction, context, error) {
  try {
    const cfg = loadConfig();
    const guild =
      interaction?.guild ||
      (cfg.guildId ? client.guilds.cache.get(cfg.guildId) : null);

    if (!guild) {
      console.error(`[debug:${context}]`, error);
      return;
    }

    const channelId = cfg.channels?.debug;
    const debugChannel = channelId
      ? guild.channels.cache.get(channelId)
      : guild.channels.cache.find((c) =>
          [
            'debug',
            '🛠-debug',
            '🔧-debug',
            '🧪-debug',
          ].includes(c.name)
        );

    const description =
      typeof error === 'string'
        ? error
        : error?.message
        ? error.message
        : 'Erro desconhecido';

    if (debugChannel) {
      await debugChannel
        .send({
          content: `⚠️ **${context}**\n${description}`.slice(0, 1900),
        })
        .catch(() => null);
    } else {
      console.error(`[debug:${context}]`, error);
    }
  } catch (err) {
    console.error('sendDebugMessage error', err, context, error);
  }
}

module.exports = { sendDebugMessage };
