const {
  ApplicationCommandType,
  ApplicationCommandOptionType,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

module.exports = {
  name: 'criarmensagem',
  description: 'Envia uma mensagem para um canal específico.',
  type: ApplicationCommandType.ChatInput,
  options: [
    {
      name: 'criarprocesso',
      description: 'Crie o painel para podermos criar processos e demais funções',
      type: ApplicationCommandOptionType.Subcommand,
    },
  ],

  run: async (client, interaction) => {
    try {
      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'criarprocesso': {
          // Permissão opcional: somente quem gerencia o servidor pode usar
          if (
            !interaction.member.permissions.has(
              PermissionFlagsBits.ManageGuild
            )
          ) {
            return interaction.reply({
              content:
                '`❌` | Você não possui permissão para utilizar este comando.',
              ephemeral: true,
            });
          }


          // Cria um botão de exemplo
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('criar_processo')
              .setLabel('Criar Processo')
              .setEmoji('⚖️')
              .setStyle(ButtonStyle.Secondary)
          );

          await interaction.channel.send({
            content: `# <:DOJ:1425900601321193649>  **Department of Justice (DOJ) do Estado de Freedom**\n**-# Sistema de Gerenciamento Oficial - SJE V1**\n> Este painel é destinado à criação de novos processos judiciais e à gestão de procedimentos internos do Departamento de Justiça.\n\n> **Como funciona?**\n> - Utilize o botão abaixo para iniciar a abertura de um novo processo.\n> - Preencha as informações solicitadas no formulário que será exibido.\n> - Após o envio, o processo será registrado e encaminhado para análise.\n\n**Atenção:** Certifique-se de fornecer todos os dados necessários para evitar atrasos no andamento do processo.\n\n-# <:DOJ:1425900601321193649> | **Painel Oficial do Department of Justice (DOJ)**`,
            components: [row],
          });

          return interaction.reply({
            content: 'Mensagem enviada com sucesso!',
            ephemeral: true,
          });
        }

        default:
          return interaction.reply({
            content: 'Subcomando não reconhecido.',
            ephemeral: true,
          });
      }
    } catch (err) {
      console.error('Error in criarmensagem command', err);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: 'Ocorreu um erro ao executar o comando.',
          ephemeral: true,
        });
      }
    }
  },
};
