const { ApplicationCommandType, ApplicationCommandOptionType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const db = require('../../lib/db');
const { buildCaseEmbed } = require('../../Templates/caseEmbed');

module.exports = {
  name: 'enviarmensagem',
  description: 'Cria o painel de ações para um processo (painel com botões).',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'case_number',
      description: 'Número do processo (ex: PROC-2025-0001)',
      type: ApplicationCommandOptionType.String,
      required: true
    }
  ],
  run: async (client, interaction) => {
    const num = interaction.options.getString('case_number');
    const caseRow = await db.getCaseByNumber(num);
    if (!caseRow) return interaction.reply({ content: 'Processo não encontrado.', ephemeral: true });

    const embed = buildCaseEmbed(caseRow);

    const buttonsRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`protocol_${caseRow.id}`).setLabel('📤 Protocolar').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`escalate_${caseRow.id}`).setLabel('⚖️ Escalonar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`edit_${caseRow.id}`).setLabel('✏️ Editar').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`enroll_${caseRow.id}`).setLabel('👥 Habilitar').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`viewthread_${caseRow.id}`).setLabel('🔗 Ver tópico').setStyle(ButtonStyle.Link).setURL(caseRow.thread_id ? `https://discord.com/channels/${interaction.guild.id}/${caseRow.thread_id}` : 'https://discord.com')
    );

    // Optionally a select menu to quick select participants or actions
    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`action_select_${caseRow.id}`).setPlaceholder('Ações rápidas').addOptions([
        { label: 'Protocolar documento', value: `protocol_${caseRow.id}` },
        { label: 'Escalonar processo', value: `escalate_${caseRow.id}` },
        { label: 'Editar processo', value: `edit_${caseRow.id}` }
      ])
    );

    await interaction.reply({ embeds: [embed], components: [buttonsRow, select] });
  }
};
