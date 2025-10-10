require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { listCases, getCaseById, getCaseByNumber } = require('./lib/db');

// load config.json safely
let config = {};
try {
	config = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'config.json')));
} catch (e) {
	// ignore
}

// Helper: verifica se membro possui role configurado em config.roles[roleKey]
function memberHasRoleByKey(member, roleKey) {
	if (!member || !member.roles) return false;
	try {
		const roleConfig = config.roles && config.roles[roleKey];
		if (roleConfig) {
			const ids = Array.isArray(roleConfig) ? roleConfig : [roleConfig];
			for (const id of ids) {
				if (member.roles.cache.has(id)) return true;
			}
		}
		// fallback: try by name (PT)
		const mapping = { judge: 'Juiz', prosecutor: 'Promotor', defender: 'Defensor', admin: 'Administrador' };
		const roleName = mapping[roleKey];
		if (roleName && member.guild && member.guild.roles) {
			const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
			if (role) return member.roles.cache.has(role.id);
		}
	} catch (e) {}
	return false;
}

// Discord client
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

// load handlers
try {
	fs.readdirSync('./Handlers').forEach((handler) => {
		try { require(`./Handlers/${handler}`)(client); } catch (e) { /* ignore handler load errors */ }
	});
} catch (e) {}

// Simple Express API
const app = express();
app.use(express.json());

const API_KEY = (config && config.apiKey) || process.env.API_KEY || null;

function requireApiKey(req, res, next) {
	if (!API_KEY) return res.status(500).json({ error: 'API key not configured on server' });
	const key = req.header('x-api-key');
	if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
	next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

function safeJsonParse(v, fallback) {
	try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}

function normalizeCase(c) {
	return {
		...c,
		parties: safeJsonParse(c.parties, []),
		participants: safeJsonParse(c.participants, {}),
		metadata: safeJsonParse(c.metadata, {}),
		timeline: safeJsonParse(c.timeline, [])
	};
}

app.get('/cases', requireApiKey, async (req, res) => {
	try {
		const limit = parseInt(req.query.limit) || 50;
		const offset = parseInt(req.query.offset) || 0;
		const rows = await listCases(limit, offset);
		return res.json(rows.map(normalizeCase));
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'internal_error' });
	}
});

app.get('/cases/id/:id', requireApiKey, async (req, res) => {
	try {
		const c = await getCaseById(req.params.id);
		if (!c) return res.status(404).json({ error: 'not_found' });
		return res.json(normalizeCase(c));
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'internal_error' });
	}
});

app.get('/cases/number/:caseNumber', requireApiKey, async (req, res) => {
	try {
		const c = await getCaseByNumber(req.params.caseNumber);
		if (!c) return res.status(404).json({ error: 'not_found' });
		return res.json(normalizeCase(c));
	} catch (e) {
		console.error(e);
		return res.status(500).json({ error: 'internal_error' });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on port ${PORT}`));

// start discord client
client.login(process.env.TOKEN).catch(e => console.error('Discord login failed:', e));
