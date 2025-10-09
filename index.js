require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const Discord = require("discord.js")
const Canvas = require("canvas")

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.GuildPresences,
		GatewayIntentBits.GuildMessageReactions,
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.MessageContent
	],
	partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction]
});

client.slashCommands = new Collection();

module.exports = client;

fs.readdirSync('./Handlers').forEach((handler) => {
	require(`./Handlers/${handler}`)(client)
});


client.login(process.env.TOKEN);
