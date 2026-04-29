const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats } = require('../utils/api');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('debug-api-top')
        .setDescription('Dump top-level API response fields for a player')
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

        const output = [
            '── Scalar / String fields ──',
            ...scalarLines,
            '',
            '── Arrays & Objects ──',
            ...arrayLines,
        ].join('\n');

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🔍  API Debug — Top-Level Fields')
            .addFields(
                { name: 'EA ID',    value: `\`${eaId}\``,    inline: true },
                { name: 'Platform', value: `\`${platform}\``, inline: true },
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
