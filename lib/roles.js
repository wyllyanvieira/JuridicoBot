const fs = require('fs');
const path = require('path');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json')));
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

module.exports = { memberHasRoleByKey };
