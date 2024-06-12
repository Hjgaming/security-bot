const { Client, Intents, Permissions, MessageActionRow, MessageButton, MessageEmbed } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const mongoose = require('mongoose');
const Config = require('./models/Config');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const mongoUri = process.env.MONGODB_URI;

const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS]
});

mongoose.connect(mongoUri).then(() => {
    console.log('Connected to MongoDB');
}).catch(err => {
    console.error('Failed to connect to MongoDB', err);
});

const userMessageCount = new Map();

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    const guilds = await client.guilds.fetch();
    guilds.forEach(async (guildData) => {
        const guild = await client.guilds.fetch(guildData.id);
        await guild.roles.fetch(); // Ensure roles are cached
        let muteRole = guild.roles.cache.find(role => role.name === "Muted");
        if (!muteRole) {
            muteRole = await guild.roles.create({
                name: "Muted",
                color: "#000000",
                permissions: []
            });
            guild.channels.cache.forEach(channel => {
                channel.permissionOverwrites.create(muteRole, {
                    SEND_MESSAGES: false,
                    ADD_REACTIONS: false,
                    SPEAK: false
                });
            });
        }
    });
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const config = await Config.findOne({ guildId: message.guild.id });
    if (!config) return;

    // Link Detection
    if (config.antiLinkEnabled) {
        const member = await message.guild.members.fetch(message.author.id);
        if (!(config.allowedRoleId && member.roles.cache.has(config.allowedRoleId))) {
            if (message.content.includes('http://') || message.content.includes('https://')) {
                await message.delete();
                await message.channel.send(`${message.author}, you are not allowed to send links.`);
                return;
            }
        }
    }

    // Bad Word Detection
    if (config.badWordsEnabled) {
        const lowerContent = message.content.toLowerCase();
        const foundBadWord = config.badWords.some(word => lowerContent.includes(word));
        if (foundBadWord) {
            await message.delete();
            await message.channel.send(`${message.author}, you used a prohibited word.`);
            return;
        }
    }

    // Spam Detection
    if (config.spamProtectionEnabled) {
        const userId = message.author.id;
        const currentTime = Date.now();
        if (!userMessageCount.has(userId)) {
            userMessageCount.set(userId, []);
        }
        const timestamps = userMessageCount.get(userId);
        timestamps.push(currentTime);
        const timeWindow = 60000; // 1 minute
        const threshold = config.spamThreshold;
        const recentMessages = timestamps.filter(timestamp => currentTime - timestamp < timeWindow);
        userMessageCount.set(userId, recentMessages);
        if (recentMessages.length > threshold) {
            const muteRole = message.guild.roles.cache.find(role => role.name === "Muted");
            await message.member.roles.add(muteRole);
            await message.channel.send(`${message.author} has been muted for spamming.`);
            setTimeout(async () => {
                await message.member.roles.remove(muteRole);
                await message.channel.send(`${message.author} has been unmuted.`);
            }, config.muteDuration * 60000);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() && !interaction.isButton()) return;

    if (interaction.isCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'setrole') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            const role = options.getRole('role');
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { allowedRoleId: role.id },
                { upsert: true, new: true }
            );
            await interaction.reply(`Allowed role set to ${role.name}`);
        } else if (commandName === 'enable_antilink') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { antiLinkEnabled: true },
                { upsert: true, new: true }
            );
            await interaction.reply('Anti-link system enabled.');
        } else if (commandName === 'disable_antilink') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { antiLinkEnabled: false },
                { upsert: true, new: true }
            );
            await interaction.reply('Anti-link system disabled.');
        } else if (commandName === 'enable_badwords') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { badWordsEnabled: true },
                { upsert: true, new: true }
            );
            await interaction.reply('Bad words filter enabled.');
        } else if (commandName === 'disable_badwords') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { badWordsEnabled: false },
                { upsert: true, new: true }
            );
            await interaction.reply('Bad words filter disabled.');
        } else if (commandName === 'add_badword') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            const badWord = options.getString('word');
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { $addToSet: { badWords: badWord } },
                { upsert: true, new: true }
            );
            await interaction.reply(`Added "${badWord}" to the list of bad words.`);
        } else if (commandName === 'remove_badword') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            const badWord = options.getString('word');
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { $pull: { badWords: badWord } },
                { upsert: true, new: true }
            );
            await interaction.reply(`Removed "${badWord}" from the list of bad words.`);
        } else if (commandName === 'enable_spam') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { spamProtectionEnabled: true },
                { upsert: true, new: true }
            );
            await interaction.reply('Spam protection enabled.');
        } else if (commandName === 'disable_spam') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { spamProtectionEnabled: false },
                { upsert: true, new: true }
            );
            await interaction.reply('Spam protection disabled.');
        } else if (commandName === 'set_spam_threshold') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            const threshold = options.getInteger('threshold');
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { spamThreshold: threshold },
                { upsert: true, new: true }
            );
            await interaction.reply(`Spam threshold set to ${threshold} messages per minute.`);
        } else if (commandName === 'set_mute_duration') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_GUILD)) {
                return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            }
            const duration = options.getInteger('duration');
            await Config.findOneAndUpdate(
                { guildId: interaction.guild.id },
                { muteDuration: duration },
                { upsert: true, new: true }
            );
            await interaction.reply(`Mute duration set to ${duration} minutes.`);
        } else if (commandName === 'ping') {
            await interaction.reply('Pong!');
        } else if (commandName === 'invite') {
            await interaction.reply(`Invite me using this link: [INVITE ME](https://discord.com/oauth2/authorize?client_id=1109396083299328090&permissions=1101927558160&scope=applications.commands+bot)`);
        } else if (commandName === 'help') {
            const embed = new MessageEmbed()
                .setTitle('Help')
                .setDescription('List of available commands:')
                .addField('/setrole [role]', 'Set the role that can send links')
                .addField('/enable_antilink', 'Enable the anti-link system')
                .addField('/disable_antilink', 'Disable the anti-link system')
                .addField('/enable_badwords', 'Enable the bad words filter')
                .addField('/disable_badwords', 'Disable the bad words filter')
                .addField('/add_badword [word]', 'Add a word to the bad words list')
                .addField('/remove_badword [word]', 'Remove a word from the bad words list')
                .addField('/enable_spam', 'Enable the spam protection')
                .addField('/disable_spam', 'Disable the spam protection')
                .addField('/set_spam_threshold [number]', 'Set the spam threshold')
                .addField('/set_mute_duration [number]', 'Set the mute duration')
                .addField('/ping', 'Replies with Pong!')
                .addField('/invite', 'Generates an invite link for the bot')
                .addField('/help', 'Shows this help message');
            await interaction.reply({ embeds: [embed] });
        }
    } else if (interaction.isButton()) {
        const memberId = interaction.message.embeds[0].footer.text;
        const member = await interaction.guild.members.fetch(memberId).catch(() => null);

        if (!member) {
            return interaction.reply({ content: `Member not found.`, ephemeral: true });
        }

        if (interaction.customId === 'mute_button') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_ROLES)) {
                return interaction.reply({ content: 'You do not have permission to use this button.', ephemeral: true });
            }
            const muteRole = interaction.guild.roles.cache.find(role => role.name === "Muted");
            await member.roles.add(muteRole);
            await interaction.reply(`${member.user.tag} has been muted.`);
        } else if (interaction.customId === 'unmute_button') {
            if (!interaction.member.permissions.has(Permissions.FLAGS.MANAGE_ROLES)) {
                return interaction.reply({ content: 'You do not have permission to use this button.', ephemeral: true });
            }
            const muteRole = interaction.guild.roles.cache.find(role => role.name === "Muted");
            await member.roles.remove(muteRole);
            await interaction.reply(`${member.user.tag} has been unmuted.`);
        }
    }
});

client.login(token);

const commands = [
    {
        name: 'setrole',
        description: 'Set the role that can send links',
        options: [
            {
                name: 'role',
                type: 8, // Corrected type for ROLE
                description: 'The role to set',
                required: true,
            },
        ],
    },
    {
        name: 'enable_antilink',
        description: 'Enable the anti-link system',
    },
    {
        name: 'disable_antilink',
        description: 'Disable the anti-link system',
    },
    {
        name: 'enable_badwords',
        description: 'Enable the bad words filter',
    },
    {
        name: 'disable_badwords',
        description: 'Disable the bad words filter',
    },
    {
        name: 'add_badword',
        description: 'Add a word to the bad words list',
        options: [
            {
                name: 'word',
                type: 3, // STRING
                description: 'The word to add',
                required: true,
            },
        ],
    },
    {
        name: 'remove_badword',
        description: 'Remove a word from the bad words list',
        options: [
            {
                name: 'word',
                type: 3, // STRING
                description: 'The word to remove',
                required: true,
            },
        ],
    },
    {
        name: 'enable_spam',
        description: 'Enable the spam protection',
    },
    {
        name: 'disable_spam',
        description: 'Disable the spam protection',
    },
    {
        name: 'set_spam_threshold',
        description: 'Set the spam threshold',
        options: [
            {
                name: 'threshold',
                type: 4, // INTEGER
                description: 'Number of messages per minute',
                required: true,
            },
        ],
    },
    {
        name: 'set_mute_duration',
        description: 'Set the mute duration',
        options: [
            {
                name: 'duration',
                type: 4, // INTEGER
                description: 'Duration in minutes',
                required: true,
            },
        ],
    },
    {
        name: 'ping',
        description: 'Replies with Pong!'
    },
    {
        name: 'invite',
        description: 'Generates an invite link for the bot'
    },
    {
        name: 'help',
        description: 'Shows the help message'
    },
];

const rest = new REST({ version: '9' }).setToken(token);

(async () => {
    try {
        console.log('Started refreshing application (/) commands globally.');

        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands globally.');
    } catch (error) {
        console.error(error);
    }
})();
