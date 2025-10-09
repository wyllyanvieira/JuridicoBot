const { ApplicationCommandType, ApplicationCommandOptionType } = require('discord.js');


module.exports = {
    name: '', // Nome do comando / Command Name
    description: "", // Descrição do comando / Command Description
    type: ApplicationCommandType.ChatInput,
    options: [
        {
          name: "", // Nome da opção / Option Name
          type: ApplicationCommandOptionType.String, // Tipo da opção / OptionType   >> String, Integer, Number, Boolean, User, Channel, Role, Mentionable, Attachment, Subcommand, SubcommandGroup
          description: "", // Descrição da opção / Option Description
          required: true
        }
      ],

      // Opções opcionais / Optional Options

    userPerms: [], // Permissões permitidas. / Allowed Permissions   >> userPerms: ['SendMessages'],
    botPerms: [], // Permissões permitidas [ Bot ]. / Allowed Permissions [ Bot ]   >> botPerms: ['SendMessages'],
    ownerOnly: true, // false


    run: async (client, interaction) => {

        // CODE 

    }
};
