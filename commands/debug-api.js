const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats } = require('../utils/api');

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

        const seasons = Array.isArray(data.redsec) ? data.redsec : null;

        if (!seasons) {
            return interaction.editReply('`data.redsec` is missing or not an array.');
        }

        // Dump every field for every season → mode
        const INCLUDED = new Set(['duos', 'quads', 'solo']);
        const lines = [];

        for (const season of seasons) {
            lines.push(`\n━━ ${season.season} ━━`);
            for (const m of season.modes ?? []) {
                const included = INCLUDED.has((m.mode ?? '').toLowerCase());
                const mark     = included ? '✓' : '✗';
                lines.push(`\n${mark} Mode: ${m.mode ?? '?'}`);
                for (const [key, val] of Object.entries(m)) {
                    if (key === 'mode' || key === 'modeId') continue;
                    lines.push(`   ${key.padEnd(18)} ${val}`);
                }
            }
        }

        const table = lines.join('\n');
        const chunks = [];
        for (let i = 0; i < table.length; i += 1800) chunks.push(table.slice(i, i + 1800));

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🔍  API Debug — Redsec Season/Mode Breakdown')
            .addFields(
                { name: 'EA ID',     value: `\`${eaId}\``,    inline: true },
                { name: 'Platform',  value: `\`${platform}\``, inline: true },
                { name: 'Seasons',   value: `\`${seasons.length}\``, inline: true },
            )
            .setFooter({ text: '✓ = included in stats  ✗ = excluded' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        for (const chunk of chunks) {
            await interaction.followUp({ content: `\`\`\`\n${chunk}\n\`\`\``, ephemeral: true });
        }
    },
};
