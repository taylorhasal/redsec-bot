const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const PLAYERS_FILE = path.join(__dirname, '..', 'players.json');

function loadPlayers() {
    try {
        return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription("View a verified member's Redsec profile")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Discord member to look up')
                .setRequired(true)),

    async execute(interaction) {
        const target  = interaction.options.getUser('user');
        const players = loadPlayers();
        const record  = players[target.id];

        if (!record) {
            return interaction.reply({
                embeds: [errorEmbed(`${target.username} has not verified their EA ID.`)],
                ephemeral: true,
            });
        }

        const winRatePct = record.winRate != null
            ? `\`${(record.winRate * 100).toFixed(1)}%\``
            : '`N/A`';

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(`🎖️  ${record.eaId}  —  Redsec Profile`)
            .setDescription(`Discord: ${target}`)
            .addFields(
                { name: '🪪 EA ID',        value: `\`${record.eaId}\``,                         inline: true },
                { name: '🖥️ Platform',     value: `\`${record.platform.toUpperCase()}\``,        inline: true },
                { name: '​',          value: '​',                                       inline: true },
                { name: '⚔️ K/D Ratio',   value: `\`${record.kd?.toFixed(2) ?? 'N/A'}\``,       inline: true },
                { name: '📈 Win Rate',     value: winRatePct,                                    inline: true },
                { name: '📊 Redsec Index', value: `\`${record.redsecIndex?.toFixed(2) ?? 'N/A'}\``, inline: true },
            )
            .setThumbnail(target.displayAvatarURL())
            .setFooter({ text: `Verified · ${new Date(record.verifiedAt).toLocaleDateString()}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('❌ Not Found')
        .setDescription(description)
        .setTimestamp();
}
