const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats } = require('../utils/api');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug-api-top')
        .setDescription('Dump top-level API fields, or drill into any array by name')
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
        .addStringOption(o =>
            o.setName('array')
                .setDescription('Name of an array to drill into (e.g. gameModes, weapons, classes, vehicles)')
                .setRequired(false)),

    async execute(interaction) {
        const eaId      = interaction.options.getString('ea_id');
        const platform  = interaction.options.getString('platform') ?? 'ea';
        const arrayName = interaction.options.getString('array')?.trim() ?? null;

        await interaction.deferReply({ ephemeral: true });

        let data;
        try {
            data = await fetchPlayerStats(eaId, platform);
        } catch (err) {
            return interaction.editReply(`API error: \`${err.message}\``);
        }

        let output;
        let title;

        if (arrayName) {
            // Drill into a specific array
            const target = data[arrayName];
            if (!Array.isArray(target)) {
                return interaction.editReply(`\`${arrayName}\` is not an array in the API response. Available arrays: ${Object.entries(data).filter(([,v]) => Array.isArray(v)).map(([k]) => k).join(', ')}`);
            }

            title = `🔍  API Debug — ${arrayName} (${target.length} entries)`;
            const lines = [];
            for (const [i, entry] of target.entries()) {
                if (typeof entry === 'object' && entry !== null) {
                    lines.push(`\n── Entry ${i + 1} ──`);
                    for (const [key, val] of Object.entries(entry)) {
                        if (typeof val === 'object' && val !== null) {
                            lines.push(`  ${key.padEnd(22)} ${JSON.stringify(val)}`);
                        } else {
                            lines.push(`  ${key.padEnd(22)} ${val}`);
                        }
                    }
                } else {
                    lines.push(`  [${i}] ${entry}`);
                }
            }
            output = lines.join('\n');
        } else {
            // Top-level overview
            title = '🔍  API Debug — Top-Level Fields';
            const scalarLines = [];
            const arrayLines  = [];

            for (const [key, val] of Object.entries(data)) {
                if (Array.isArray(val)) {
                    arrayLines.push(`  ${key.padEnd(22)} array[${val.length}]`);
                } else if (val !== null && typeof val === 'object') {
                    arrayLines.push(`  ${key.padEnd(22)} object{${Object.keys(val).join(', ')}}`);
                } else {
                    scalarLines.push(`  ${key.padEnd(22)} ${val}`);
                }
            }

            output = [
                '── Scalar / String fields ──',
                ...scalarLines,
                '',
                '── Arrays & Objects ──',
                ...arrayLines,
            ].join('\n');
        }

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(title)
            .addFields(
                { name: 'EA ID',    value: `\`${eaId}\``,             inline: true },
                { name: 'Platform', value: `\`${platform}\``,          inline: true },
                { name: 'Array',    value: `\`${arrayName ?? 'top'}\``, inline: true },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        const chunks = [];
        for (let i = 0; i < output.length; i += 1800) chunks.push(output.slice(i, i + 1800));
        for (const chunk of chunks) {
            await interaction.followUp({ content: `\`\`\`\n${chunk}\n\`\`\``, ephemeral: true });
        }
    },
};
