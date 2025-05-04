require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const osrsLevels = [
  0, 83, 174, 276, 388, 512, 650, 801, 969, 1154, 1358, 1584, 1833, 2107, 2411,
  2746, 3115, 3523, 3973, 4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824,
  12031, 13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
  37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721, 101333,
  111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
  273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032,
  668051, 737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581,
  1629200, 1798808, 1986068, 2192818, 2421087, 2673114, 2951373, 3258594,
  3597792, 3972294, 4385776, 4842295, 5346332, 5902831, 6517253, 7195629,
  7944614, 8771558, 9684577, 10692629, 11805606, 13034431
];

const bhRates = [
  { from: 25, to: 34, Attack: 87.5,  Strength: 87.5,  Defence: 87.5,  Hitpoints: 87.5,  Ranged:  80, Magic:  80, Prayer: 45 },
  { from: 35, to: 42, Attack: 175,   Strength: 175,   Defence: 175,   Hitpoints: 175,   Ranged: 160, Magic: 160, Prayer: 90 },
  { from: 43, to: 48, Attack: 262.5, Strength: 262.5, Defence: 262.5, Hitpoints: 262.5, Ranged: 240, Magic: 240, Prayer:135 },
  { from: 49, to: 54, Attack: 350,   Strength: 350,   Defence: 350,   Hitpoints: 350,   Ranged: 320, Magic: 320, Prayer:180 },
  { from: 55, to: 59, Attack: 437.5, Strength: 437.5, Defence: 437.5, Hitpoints: 437.5, Ranged: 400, Magic: 400, Prayer:225 },
  { from: 60, to: 64, Attack: 525,   Strength: 525,   Defence: 525,   Hitpoints: 525,   Ranged: 480, Magic: 480, Prayer:270 },
  { from: 65, to: 69, Attack: 612.5, Strength: 612.5, Defence: 612.5, Hitpoints: 612.5, Ranged: 560, Magic: 560, Prayer:315 },
  { from: 70, to: 73, Attack: 700,   Strength: 700,   Defence: 700,   Hitpoints: 700,   Ranged: 640, Magic: 640, Prayer:360 },
  { from: 74, to: 77, Attack: 787.5, Strength: 787.5, Defence: 787.5, Hitpoints: 787.5, Ranged: 720, Magic: 720, Prayer:405 },
  { from: 78, to: 81, Attack: 875,   Strength: 875,   Defence: 875,   Hitpoints: 875,   Ranged: 800, Magic: 800, Prayer:450 },
  { from: 82, to: 84, Attack: 962.5, Strength: 962.5, Defence: 962.5, Hitpoints: 962.5, Ranged: 880, Magic: 880, Prayer:495 },
  { from: 85, to: 88, Attack: 1050,  Strength: 1050,  Defence: 1050,  Hitpoints: 1050,  Ranged: 960, Magic: 960, Prayer:540 },
  { from: 89, to: 91, Attack: 1137.5,Strength:1137.5, Defence:1137.5, Hitpoints:1137.5, Ranged:1040, Magic:1040, Prayer:585 },
  { from: 92, to: 94, Attack: 1225,  Strength: 1225,  Defence: 1225,  Hitpoints: 1225,  Ranged:1120, Magic:1120, Prayer:630 },
  { from: 95, to: 97, Attack: 1312.5,Strength:1312.5, Defence:1312.5, Hitpoints:1312.5, Ranged:1200, Magic:1200, Prayer:675 },
  { from: 98, to: 99, Attack: 1400,  Strength: 1400,  Defence: 1400,  Hitpoints: 1400,  Ranged:1280, Magic:1280, Prayer:720 }
];

function getLevel(xp) {
  for (let i = osrsLevels.length - 1; i >= 0; i--) {
    if (xp >= osrsLevels[i]) return i + 1;
  }
  return 1;
}

function getXPForLevel(level) {
  if (level < 1 || level > 99) return 0;
  return osrsLevels[level - 1];
}

function getBaseRate(skill, level) {
  const band = bhRates.find(b => level >= b.from && level <= b.to);
  return band ? band[skill] || 0 : 0;
}

const skillIcons = {
  Strength: '<:Str:1258493561880449159>',
  Attack:   '<:Attack:1258493560353980528>',
  Defence:  '<:Def:1258493562983551050>',
  Hitpoints:'<:Hp:1258493568239013908>',
  Ranged:   '<:Ranged:1258493564652879942>',
  Magic:    '<:Magic:1258493567173656678>',
  Prayer:   '<:Prayer:1258493566028611625>'
};

function calculateKillAndEmblemUsage(pointsRequired) {
  let kills = 0, totalPoints = 0, emblems = 0;
  while (totalPoints < pointsRequired) {
    kills++;
    let milestone = 0;
    if      (kills % 500 === 0) milestone += 25;
    else if (kills % 100 === 0) milestone += 10;
    else if (kills %  50 === 0) milestone += 5;
    else if (kills %  10 === 0) milestone += 3;

    totalPoints += 2 + milestone;
    if (kills % 9 === 0) {
      emblems++;
      totalPoints += 56;
    }
  }
  return { kills, emblems };
}

async function respondWithpoints(message, skill, startXP, targetLevel, combatLevel) {
  const targetXP = getXPForLevel(targetLevel);
  const displayLevel = getLevel(startXP);

  if (displayLevel >= targetLevel) {
    return message.reply(
      `You are already level ${displayLevel} (${startXP.toLocaleString()} XP), which is equal to or higher than level ${targetLevel}.`
    );
  }

  let costPerPoint = 0;
  if (!isNaN(combatLevel)) {
    if (combatLevel >= 30 && combatLevel <= 60) costPerPoint = 400000;
    else if (combatLevel >= 70 && combatLevel <= 90) costPerPoint = 500000;
    else if (combatLevel >= 100 && combatLevel <= 126) costPerPoint = 1000000;
  }

  let xp = startXP;
  let pointsUsed = 0;
  let breakdown = [];
  let bandId = null, bandCounter = 0;

  while (xp < targetXP && pointsUsed < 10000) {
    const level = getLevel(xp);            // ← use actual level here
    const base  = getBaseRate(skill, level);
    if (!base) break;

    const band = bhRates.find(b => level >= b.from && level <= b.to);
    const thisBandId = `${band.from}-${band.to}`;

    if (bandId !== thisBandId) {
      if (breakdown.length) breakdown[breakdown.length - 1].shut = true;
      bandId = thisBandId;
      bandCounter = 0;
    }

    bandCounter++;
    pointsUsed++;

    let mult = 1;
    if (bandCounter >= 100) mult = 1.1;
    else if (bandCounter >= 10) mult = 1.01;

    const xpPerPoint = parseFloat((base * mult).toFixed(1));
    xp += xpPerPoint;

    const note = bandCounter >= 100 ? '10% Bonus' : bandCounter >= 10 ? '1% Bonus' : '';
    const last = breakdown[breakdown.length - 1];
    if (last && last.xpPerPoint === xpPerPoint && last.note === note && !last.shut) {
      last.points++;
    } else {
      breakdown.push({ xpPerPoint, points: 1, note, shut: false });
    }
  }

  const newLevel = targetLevel;
  const totalCost = costPerPoint ? pointsUsed * costPerPoint : 0;
  const { kills, emblems } = calculateKillAndEmblemUsage(pointsUsed);

  // Build table
  let table = 'XP per Point | Points Used | Notes\n';
  table += '--------------|-------------|------------------\n';
  let summarySteps = [], currentSum = 0;
  for (let i = 0; i < breakdown.length; i++) {
    const { xpPerPoint, points, note, shut } = breakdown[i];
    const notes = note + (shut ? (note ? ', shut interface' : 'shut interface') : '');
    table += `${xpPerPoint.toString().padEnd(13)}| ${points.toString().padEnd(11)}| ${notes}\n`;
    currentSum += points;
    if (shut || i === breakdown.length - 1) {
      summarySteps.push(`use ${currentSum} points${shut ? ' then shut the interface' : ''}`);
      currentSum = 0;
    }
  }

  const skillIcon = skillIcons[skill] || '⚔️';
  const embed = new EmbedBuilder()
    .setTitle(`${skillIcon} ${skill} from XP ${startXP.toLocaleString()} to Level ${targetLevel}`)
    .setColor('#FF0000')
    .setThumbnail('https://i.imgur.com/frBEEu3.gif')
    .setDescription(
      `📊 **Current Level:** ${displayLevel} (from ${startXP.toLocaleString()} XP)\n` +
      `<:skull_TzHaar_Fight_Pit_icon:1258476429549633616> **Points Required:** ${pointsUsed.toLocaleString()}\n` +
      `<:Archaic_emblem_tier_10_detail:1258490088485159032> **Estimated Tier 10 Emblems Needed:** ${emblems}\n` +
      `<:Skull_Loot_key_icon_3:1258476433295278261> **Estimated Kills Required:** ${kills}\n\n` +
      `\`\`\`\n${table}\`\`\``
    )
    .addFields({
      name: '📝 Summary',
      value: summarySteps.length
        ? `Please ${summarySteps.join(', then ')}.\nYou should now be at level ${newLevel}.`
        : 'No progress simulated. Check inputs.'
    });

  if (costPerPoint) {
    embed.addFields({
      name: '💰 Estimated Cost',
      value: `${totalCost.toLocaleString()} GP at ${costPerPoint.toLocaleString()} per point.`
    });
  }

  await message.channel.send({ embeds: [embed] });
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const args    = message.content.trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === '!points') {
    if (args.length < 3) 
      return message.reply('Usage: `!points <startXP> <targetLevel> <skill> [combatLevel]`');
    const [startXP, targetLevel, skill, combatLevel] = [
      parseInt(args[0]),
      parseInt(args[1]),
      args[2],
      parseInt(args[3])
    ];
    await respondWithpoints(message, skill, startXP, targetLevel, combatLevel);
  }

  if (command === '!skills') {
    const list = Object.keys(skillIcons).map(s => `${skillIcons[s]} ${s}`);
    return message.reply(`**Available Skills:**\n${list.join('\n')}`);
  }

  if (command === '!lvl') {
    if (args.length < 2) 
      return message.reply('Usage: `!lvl <startXP> <targetLevel>`');
    const startXP     = parseInt(args[0]);
    const targetLevel = parseInt(args[1]);
    if (isNaN(startXP) || isNaN(targetLevel) || targetLevel < 1 || targetLevel > 99) {
      return message.reply('Please provide valid numbers: XP and a level between 1 and 99.');
    }
    const currentLevel = getLevel(startXP);
    const targetXPVal  = getXPForLevel(targetLevel);
    if (startXP >= targetXPVal) {
      return message.reply(
        `You are already level ${currentLevel} (${startXP.toLocaleString()} XP), which is enough for level ${targetLevel}.`
      );
    }
    const diff = targetXPVal - startXP;
    return message.reply(
      `You are currently level **${currentLevel}** with **${startXP.toLocaleString()} XP**.\n` +
      `You need **${diff.toLocaleString()} XP** to reach level **${targetLevel}**.`
    );
  }

  if (command === '!help') {
    return message.channel.send(`**💀 BH XP Bot Help**
\`\`\`
!points <startXP> <targetLevel> <skill> [combatLevel]
  → Simulates token usage and XP gains.

!lvl <startXP> <targetLevel>
  → Calculates XP difference between current XP and desired level.

!skills
  → Lists valid skills.

!help
  → Shows this help menu.
\`\`\``);
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.login(process.env.TOKEN);
