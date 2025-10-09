const fs = require('fs');
const path = require('path');
let config = {};
try {
  config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json')));
} catch (e) {
  // ignore
}

/**
 * memberHasRoleByKey: verifica se membro possui role cujo ID está em config.roles[roleKey]
 * roleKey: 'judge' | 'prosecutor' | 'defender' | 'admin'
 */
function memberHasRoleByKey(member, roleKey) {
  if (!member || !member.roles) return false;
  try {
    const roleId = config.roles && config.roles[roleKey];
    if (roleId) return member.roles.cache.has(roleId);
    // fallback: try by name
    const mapping = { judge: 'Juiz', prosecutor: 'Promotor', defender: 'Defensor', admin: 'Administrador' };
    const roleName = mapping[roleKey];
    if (roleName) {
      const role = member.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());
      if (role) return member.roles.cache.has(role.id);
    }
  } catch (e) {}
  return false;
}

module.exports = { memberHasRoleByKey };
