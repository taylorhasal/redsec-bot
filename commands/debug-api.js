const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats, REDSEC_MODE_IDS } = require('../utils/api');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug-api')
        .setDescription('Dump raw Gametools API response structure for debugging')
        .addStringOption(o =>
            o.setName('ea_id').setDescription('EA / in-game username').setRequired(true))
        .addStringOption(o =>
            o.setName('platform')
                .setDescription('Platform (default: ea)')
                .addChoices(
                    { name: 'EA',          value: 'ea' },
                    { name: 'Steam',       value: 'steam' },
                    { name: 'PlayStation', value: 'psn' },
                    { name: 'Xbox',        value: 'xbox' },
                    { name: 'Epic',        value: 'epic' },
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const eaId     = interaction.options.getString('ea_id');
        const platform = interaction.options.getString('platform') ?? 'ea';

        await interaction.deferReply({ ephemeral: true });

        let data;
        try {
            data = await fetchPlayerStats(eaId, platform);
        } catch (err) {
            return interaction.editReply(`API error: \`${err.message}\``);
        }

        const gameModes = Array.isArray(data.gameModes) ? data.gameModes : null;
        if (!gameModes) {
            return interaction.editReply('`data.gameModes` is missing or not an array.');
        }

        const lines  = [];
        let included = 0;
        for (const m of gameModes) {
            const id    = m.id ?? '?';
            const isRed = REDSEC_MODE_IDS.has(id);
            if (isRed) included++;
            const mark  = isRed ? '✓' : '✗';
            lines.push(`\n${mark} Mode: ${id}`);
            for (const [key, val] of Object.entries(m)) {
                if (key === 'id') continue;
                lines.push(`   ${key.padEnd(18)} ${val}`);
            }
        }

        const table = lines.join('\n');
        const chunks = [];
        for (let i = 0; i < table.length; i += 1800) chunks.push(table.slice(i, i + 1800));

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🔍  API Debug — Game Modes Breakdown')
            .addFields(
                { name: 'EA ID',    value: `\`${eaId}\``,                              inline: true },
                { name: 'Platform', value: `\`${platform}\``,                          inline: true },
                { name: 'Modes',    value: `\`${gameModes.length} (${included} Redsec)\``, inline: true },
            )
            .setFooter({ text: '✓ = counted in Redsec stats  ✗ = excluded' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        for (const chunk of chunks) {
            await interaction.followUp({ content: `\`\`\`\n${chunk}\n\`\`\``, ephemeral: true });
        }
    },
};
