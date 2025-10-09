const fs = require('fs');
const chalk = require('chalk'); 

module.exports = (client) => {
	fs.readdirSync('./Events/').filter((file) => file.endsWith('.js')).forEach((event) => {
		require(`../Events/${event}`);
	})
	console.log(chalk.green('Eventos • Ok'));
};
