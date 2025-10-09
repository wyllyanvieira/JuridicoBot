const { ApplicationCommandType, ApplicationCommandOptionType, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../lib/db');
const { buildCaseEmbed } = require('../../Templates/caseEmbed');

module.exports = {
  name: 'case',
  description: 'Gerenciar processos judiciais',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'create',
      description: 'Criar um novo processo',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'list',
      description: 'Listar processos recentes',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'manage',
      description: 'Editar um processo',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'enroll',
      description: 'Solicitar habilitação em um processo',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'upload',
      description: 'Protocolar documento em um processo',
      type: ApplicationCommandOptionType.Subcommand
    },
    {
      name: 'escalate',
      description: 'Escalonar processo para outra instância',
      type: ApplicationCommandOptionType.Subcommand,
      options: [
        { name: 'case_id', type: ApplicationCommandOptionType.String, description: 'ID ou número do processo', required: true },
        { name: 'instance', type: ApplicationCommandOptionType.Integer, description: 'Instância destino (1,2,3)', required: true }
      ]
    },
    {
      name: 'hearing',
      description: 'Gerenciar audiências',
      type: ApplicationCommandOptionType.SubcommandGroup,
      options: [
        {
          name: 'create',
          description: 'Criar nova audiência',
          type: ApplicationCommandOptionType.Subcommand
        }
      ]
    }
  ],

  userPerms: [],
  botPerms: [],
  ownerOnly: false,

  run: async (client, interaction) => {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'create') {
      // open modal to create case with requested fields:
      // Nome Polo Ativo, State ID Polo Ativo, Nome Polo Passivo, State ID Polo Passivo, Tipo de Processo
      const modal = new ModalBuilder().setCustomId('case_create_modal').setTitle('Criar Processo');

      const activeName = new TextInputBuilder().setCustomId('active_name').setLabel('Nome do Polo Ativo').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
      const activeState = new TextInputBuilder().setCustomId('active_state').setLabel('State ID do Polo Ativo').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
      const passiveName = new TextInputBuilder().setCustomId('passive_name').setLabel('Nome do Polo Passivo').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
      const passiveState = new TextInputBuilder().setCustomId('passive_state').setLabel('State ID do Polo Passivo').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
      const procType = new TextInputBuilder().setCustomId('case_type').setLabel('Tipo de Processo (Civil/Crim/Ético/Admin)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);

      // exactly 5 components
      modal.addComponents(
        new ActionRowBuilder().addComponents(activeName),
        new ActionRowBuilder().addComponents(activeState),
        new ActionRowBuilder().addComponents(passiveName),
        new ActionRowBuilder().addComponents(passiveState),
        new ActionRowBuilder().addComponents(procType)
      );

      return interaction.showModal(modal);
    }

    if (sub === 'list') {
      const rows = await db.listCases(10, 0);
      if (!rows || rows.length === 0) return interaction.reply({ content: 'Nenhum processo encontrado.', ephemeral: true });

      const embeds = rows.map(r => {
        const embed = buildCaseEmbed(r);
        return embed;
      });

      return interaction.reply({ embeds, ephemeral: true });
    }

    // stubs for other commands
    if (sub === 'manage') {
      return interaction.reply({ content: 'Comando /case manage ainda não implementado. Em desenvolvimento.', ephemeral: true });
    }
    if (sub === 'enroll') {
      return interaction.reply({ content: 'Comando /case enroll ainda não implementado. Em desenvolvimento.', ephemeral: true });
    }
    if (sub === 'upload') {
      return interaction.reply({ content: 'Comando /case upload ainda não implementado. Em desenvolvimento.', ephemeral: true });
    }
    if (sub === 'escalate') {
      const idOrNum = interaction.options.getString('case_id');
      const target = interaction.options.getInteger('instance');
      // find case by id or number
      let caseRow = null;
      if (/^\d+$/.test(idOrNum)) caseRow = await db.get('SELECT * FROM cases WHERE id = ?', [parseInt(idOrNum)]);
      if (!caseRow) caseRow = await db.get('SELECT * FROM cases WHERE case_number = ?', [idOrNum]);
      if (!caseRow) return interaction.reply({ content: 'Caso não encontrado.', ephemeral: true });
      // check permission via roles
      const roles = require('../../lib/roles');
      if (!roles.memberHasRoleByKey(interaction.member, 'judge') && !roles.memberHasRoleByKey(interaction.member, 'admin')) {
        return interaction.reply({ content: 'Você não tem permissão para escalonar processos.', ephemeral: true });
      }
      // perform escalate
      const caseActions = require('../../lib/caseActions');
      try {
        await caseActions.escalateCase(caseRow, target, client, interaction.user);
        return interaction.reply({ content: `Processo escalonado para a instância ${target}.`, ephemeral: true });
      } catch (err) {
        return interaction.reply({ content: `Falha ao escalonar: ${err.message}`, ephemeral: true });
      }
    }

    // hearing create via subcommand group
    const group = interaction.options.getSubcommandGroup(false);
    if (group === 'hearing') {
      const sub2 = interaction.options.getSubcommand();
      if (sub2 === 'create') {
        const modal = new ModalBuilder().setCustomId('hearing_create_modal').setTitle('Agendar Audiência');
        const when = new TextInputBuilder().setCustomId('hearing_when').setLabel('Data e hora (ISO ou dd/mm/yyyy hh:mm)').setStyle(TextInputStyle.Short).setRequired(true);
        const duration = new TextInputBuilder().setCustomId('hearing_duration').setLabel('Duração (minutos)').setStyle(TextInputStyle.Short).setRequired(true);
        const location = new TextInputBuilder().setCustomId('hearing_location').setLabel('Local').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(when), new ActionRowBuilder().addComponents(duration), new ActionRowBuilder().addComponents(location));
        return interaction.showModal(modal);
      }
    }

    return interaction.reply({ content: 'Subcomando inválido.', ephemeral: true });
  }
};
