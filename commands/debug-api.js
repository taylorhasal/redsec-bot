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
                .setDescription('Platform (default: pc)')
                .addChoices(
                    { name: 'PC', value: 'pc' },
                    { name: 'PlayStation 5', value: 'ps5' },
                    { name: 'Xbox Series', value: 'xboxseries' }
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const eaId     = interaction.options.getString('ea_id');
        const platform = interaction.options.getString('platform') ?? 'pc';

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

        // Build a table of every season → mode with raw field values
        const INCLUDED = new Set(['duos', 'quads']);
        const lines = [];
        let totMatches = 0, totWins = 0, totLosses = 0, totKills = 0;

        for (const season of seasons) {
            lines.push(`\n── ${season.season} ──`);
            for (const m of season.modes ?? []) {
                const included = INCLUDED.has((m.mode ?? '').toLowerCase());
                const losses   = m.losses ?? m.loses ?? '?';
                const mark     = included ? '✓' : '✗';
                lines.push(
                    `${mark} ${(m.mode ?? '?').padEnd(10)}  matches:${String(m.matches ?? '?').padStart(4)}` +
                    `  wins:${String(m.wins ?? '?').padStart(4)}  losses:${String(losses).padStart(4)}` +
                    `  kills:${String(m.kills ?? '?').padStart(5)}` +
                    `  losses_key:"${m.losses !== undefined ? 'losses' : m.loses !== undefined ? 'loses' : 'MISSING'}"`
                );
                if (included) {
                    totMatches += m.matches ?? 0;
                    totWins    += m.wins    ?? 0;
                    totLosses  += m.losses ?? m.loses ?? 0;
                    totKills   += m.kills   ?? 0;
                }
            }
        }

        lines.push(`\n── Aggregated totals (✓ modes only) ──`);
        lines.push(`matches:${totMatches}  wins:${totWins}  losses:${totLosses}  kills:${totKills}`);
        lines.push(`(top-level matchesPlayed: ${data.matchesPlayed ?? 'N/A'})`);

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
