require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// ───────────────── DB (customer portal) ─────────────────
const Database = require('better-sqlite3');
const db = new Database('data.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    userId TEXT PRIMARY KEY,
    total_gp INTEGER NOT NULL DEFAULT 0,
    total_fiat INTEGER NOT NULL DEFAULT 0, -- cents (USD)
    orders_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    gp_amount INTEGER NOT NULL,
    fiat_amount INTEGER NOT NULL, -- cents (USD)
    note TEXT,                    -- store "points ordered"
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    gp_amount INTEGER NOT NULL,
    fiat_amount INTEGER NOT NULL, -- cents (USD)
    note TEXT,                    -- store "points ordered"
    created_at TEXT NOT NULL
  );
`);

const nowISO = () => new Date().toISOString();
const toCents = v => Math.round(parseFloat(v) * 100);

// USD
const moneyStr = cents => `$${(cents / 100).toFixed(2)}`;

// GP short formatter (k/m/b)
function formatGpShort(n) {
  const abs = Math.abs(n);
  const dropZeros = s => s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (abs >= 1_000_000_000) return dropZeros((n / 1_000_000_000).toFixed(2)) + 'b';
  if (abs >= 1_000_000)     return dropZeros((n / 1_000_000).toFixed(2)) + 'm';
  if (abs >= 1_000)         return dropZeros((n / 1_000).toFixed(2)) + 'k';
  return n.toLocaleString();
}
const fmtInt = n => Number(n).toLocaleString();
const parseUserId = mention => (mention || '').replace(/[<@!>]/g, '');

// prepared statements
const STMT = {
  getCustomer: db.prepare(`SELECT * FROM customers WHERE userId = ?`),
  insertCustomer: db.prepare(`
    INSERT INTO customers (userId, total_gp, total_fiat, orders_count, created_at, updated_at)
    VALUES (?, 0, 0, 0, ?, ?)
  `),
  addOrder: db.prepare(`
    INSERT INTO orders (userId, gp_amount, fiat_amount, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  addQuote: db.prepare(`
    INSERT INTO quotes (userId, gp_amount, fiat_amount, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  listOrders: db.prepare(`
    SELECT * FROM orders WHERE userId = ? ORDER BY id DESC LIMIT ?
  `),
  listQuotes: db.prepare(`
    SELECT * FROM quotes WHERE userId = ? ORDER BY id DESC LIMIT ?
  `),
  updateTotals: db.prepare(`
    UPDATE customers
       SET total_gp = total_gp + ?,
           total_fiat = total_fiat + ?,
           orders_count = orders_count + 1,
           updated_at = ?
     WHERE userId = ?
  `)
};

// ───────────────── Discord client ─────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ───── OSRS XP TABLE ─────
const osrsLevels = [
  0,   83,   174,  276,  388,  512,  650,  801,  969, 1154,
  1358,1584, 1833, 2107, 2411, 2746, 3115, 3523, 3973,4470,
  5018,5624, 6291, 7028, 7842, 8740, 9730,10824,12031,13363,
  14833,16456,18247,20224,22406,24815,27473,30408,33648,37224,
  41171,45529,50339,55649,61512,67983,75127,83014,91721,101333,
  111945,123660,136594,150872,166636,184040,203254,224466,247886,273742,
  302288,333804,368599,407015,449428,496254,547953,605032,668051,737627,
  814445,899257,992895,1096278,1210421,1336443,1475581,1629200,1798808,1986068,
  2192818,2421087,2673114,2951373,3258594,3597792,3972294,4385776,4842295,5346332,
  5902831,6517253,7195629,7944614,8771558,9684577,10692629,11805606,13034431
];

// ───── BH RATES BY BAND ─────
const bhRates = [
  { from: 25, to: 34, Attack: 87.5,  Strength: 87.5,  Defence: 87.5,  Hitpoints: 87.5,  Ranged: 80,  Magic: 80,  Prayer: 45 },
  { from: 35, to: 42, Attack: 175,   Strength: 175,   Defence: 175,   Hitpoints: 175,   Ranged: 160, Magic: 160, Prayer: 90 },
  { from: 43, to: 48, Attack: 262.5, Strength: 262.5, Defence: 262.5, Hitpoints: 262.5, Ranged: 240, Magic: 240, Prayer: 135 },
  { from: 49, to: 54, Attack: 350,   Strength: 350,   Defence: 350,   Hitpoints: 350,   Ranged: 320, Magic: 320, Prayer: 180 },
  { from: 55, to: 59, Attack: 437.5, Strength: 437.5, Defence: 437.5, Hitpoints: 437.5, Ranged: 400, Magic: 400, Prayer: 225 },
  { from: 60, to: 64, Attack: 525,   Strength: 525,   Defence: 525,   Hitpoints: 525,   Ranged: 480, Magic: 480, Prayer: 270 },
  { from: 65, to: 69, Attack: 612.5, Strength: 612.5, Defence: 612.5, Hitpoints: 612.5, Ranged: 560, Magic: 560, Prayer: 315 },
  { from: 70, to: 73, Attack: 700,   Strength: 700,   Defence: 700,   Hitpoints: 700,   Ranged: 640, Magic: 640, Prayer: 360 },
  { from: 74, to: 77, Attack: 787.5, Strength: 787.5, Defence: 787.5, Hitpoints: 787.5, Ranged: 720, Magic: 720, Prayer: 405 },
  { from: 78, to: 81, Attack: 875,   Strength: 875,   Defence: 875,   Hitpoints: 875,   Ranged: 800, Magic: 800, Prayer: 450 },
  { from: 82, to: 84, Attack: 962.5, Strength: 962.5, Defence: 962.5, Hitpoints: 962.5, Ranged: 880, Magic: 880, Prayer: 495 },
  { from: 85, to: 88, Attack: 1050,  Strength: 1050,  Defence: 1050,  Hitpoints: 1050,  Ranged: 960, Magic: 960, Prayer: 540 },
  { from: 89, to: 91, Attack: 1137.5,Strength:1137.5, Defence:1137.5,Hitpoints:1137.5,Ranged:1040,Magic:1040,Prayer:585 },
  { from: 92, to: 94, Attack: 1225,  Strength: 1225,  Defence: 1225,  Hitpoints: 1225,  Ranged:1120,Magic:1120,Prayer:630 },
  { from: 95, to: 97, Attack: 1312.5,Strength:1312.5, Defence:1312.5,Hitpoints:1312.5,Ranged:1200,Magic:1200,Prayer:675 },
  { from: 98, to: 99, Attack: 1400,  Strength: 1400,  Defence: 1400,  Hitpoints: 1400,  Ranged:1280,Magic:1280,Prayer:720 }
];

const skillIcons = {
  Strength:  '<:Str:1258493561880449159>',
  Attack:    '<:Attack:1258493560353980528>',
  Defence:   '<:Def:1258493562983551050>',
  Hitpoints: '<:Hp:1258493568239013908>',
  Ranged:    '<:Ranged:1258493564652879942>',
  Magic:     '<:Magic:1258493567173656678>',
  Prayer:    '<:Prayer:1258493566028611625>'
};

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

function getBaseRate(skill, lvl) {
  const band = bhRates.find(b => lvl >= b.from && lvl <= b.to);
  return band ? band[skill] || 0 : 0;
}

function calculateKillAndEmblemUsage(points) {
  let kills = 0, totalPts = 0, emblems = 0;
  while (totalPts < points) {
    kills++;
    let milestone = 0;
    if      (kills % 500 === 0) milestone += 25;
    else if (kills % 100 === 0) milestone += 10;
    else if (kills %  50 === 0) milestone += 5;
    else if (kills %  10 === 0) milestone += 3;
    totalPts += 2 + milestone;
    if (kills % 9 === 0) {
      emblems++;
      totalPts += 56;
    }
  }
  return { kills, emblems };
}

// ───────────────── BH respondWithPoints ─────────────────
async function respondWithPoints(
  message,
  skill,
  startXP,
  targetLevel,
  combatLevel = NaN,
  discountPct = 0
) {
  const targetXP     = getXPForLevel(targetLevel);
  const displayLevel = getLevel(startXP);

  if (startXP >= targetXP) {
    const already = new EmbedBuilder()
      .setTitle('ℹ️ Already Enough XP')
      .setColor('#FFCC00')
      .setDescription(`You’re already level **${displayLevel}** (${startXP.toLocaleString()} XP), which is ≥ level **${targetLevel}**.`);
    return message.channel.send({ embeds: [already] });
  }

  let costPerPoint = 0;
  if (!isNaN(combatLevel)) {
    if (combatLevel >= 30 && combatLevel <= 69)       costPerPoint = 400_000;
    else if (combatLevel >= 70 && combatLevel <= 99)  costPerPoint = 500_000;
    else if (combatLevel >= 100 && combatLevel <= 126) costPerPoint = 1_000_000;
  }

  let xp            = startXP;
  let pointsUsed    = 0;
  let streakInBand  = 0;
  let currentBand   = null;
  let bandStartXP   = startXP;
  let baseHistory   = [];

  let currRow       = null;
  const breakdown   = [];
  const round1      = n => parseFloat(n.toFixed(1));

  function pushRow(shut) {
    if (!currRow) return;
    currRow.shut = shut;
    breakdown.push(currRow);
    currRow = null;
  }

  while (xp < targetXP) {
    const lvl     = getLevel(xp);
    const base    = getBaseRate(skill, lvl);
    const bandDef = bhRates.find(b => lvl >= b.from && lvl <= b.to);
    const bandKey = `${bandDef.from}-${bandDef.to}`;

    if (bandKey !== currentBand) {
      pushRow(true);
      currentBand  = bandKey;
      streakInBand = 0;
      baseHistory  = [];
      bandStartXP  = xp;
    }

    streakInBand++;
    pointsUsed++;
    baseHistory.push(base);

    if (streakInBand === 100) {
      const retroXP = baseHistory.reduce((s,b) => s + b*1.10, 0);
      xp = bandStartXP + retroXP;
      currRow = {
        xpPerPoint: round1(baseHistory[0]*1.10),
        points:     100,
        note:       '10% Bonus',
        shut:       false
      };
      pushRow(false);
      continue;
    }

    const mult = streakInBand >= 100 ? 1.10
               : streakInBand >= 10  ? 1.01
               : 1.00;
    const gain = base * mult;

    if (xp + gain >= targetXP) {
      const xpPP = round1(gain);
      const note = mult > 1 ? (mult>1.01?'10% Bonus':'1% Bonus') : '';
      if (currRow && currRow.xpPerPoint === xpPP && currRow.note === note && !currRow.shut) {
        currRow.points++;
        pushRow(true);
      } else {
        currRow = { xpPerPoint: xpPP, points: 1, note, shut: true };
        pushRow(true);
      }
      xp = targetXP;
      break;
    }

    xp += gain;
    const xpPP = round1(gain);
    const note = mult > 1 ? (mult>1.01?'10% Bonus':'1% Bonus') : '';
    if (currRow && currRow.xpPerPoint === xpPP && currRow.note === note && !currRow.shut) {
      currRow.points++;
    } else {
      pushRow(false);
      currRow = { xpPerPoint: xpPP, points: 1, note, shut: false };
    }
  }

  pushRow(false);

  // breakdown table
  let table = 'XP per Point | Points Used | Notes\n'
            + '-------------|-------------|----------------\n';
  for (const r of breakdown) {
    const noteText = r.note + (r.shut ? (r.note ? ', shut interface' : 'shut interface') : '');
    table += `${r.xpPerPoint.toString().padEnd(13)}| ${r.points.toString().padEnd(11)}| ${noteText}\n`;
  }

  // bullet “How to spend” with -9 correction
  const howTo = [];
  let running = 0;
  for (const row of breakdown) {
    running += row.points;
    if (row.shut) {
      const actual = Math.max(0, running - 9);
      howTo.push(`- Use ${actual} points, then shut interface`);
      running = 0;
    }
  }
  if (running > 0) {
    const actual = Math.max(0, running - 9);
    howTo.push(`- Use ${actual} points`);
  }

  const { kills, emblems } = calculateKillAndEmblemUsage(pointsUsed);

  const icon = skillIcons[skill] || '⚔️';
  const basicEmbed = new EmbedBuilder()
    .setTitle(`${icon} ${skill} from XP ${startXP.toLocaleString()} to Level ${targetLevel}`)
    .setColor('#FF0000')
    .setThumbnail('https://i.imgur.com/frBEEu3.gif')
    .setDescription(
      `📊 **Current Level:** ${displayLevel} (${startXP.toLocaleString()} XP)\n` +
      `💀 **Points Required:** ${pointsUsed.toLocaleString()}\n` +
      `🏅 **Tier 10 Emblems:** ${emblems}\n` +
      `🔑 **Kills Required:** ${kills}`
    )
    .addFields({
      name: '📝 How to Spend',
      value: howTo.length ? howTo.join('\n') + `\n\nYou should now be level ${targetLevel}.` : 'No steps generated.'
    });

  await message.channel.send({ embeds: [basicEmbed] });

  // table as spoiler file
  const fileBuffer = Buffer.from(table, 'utf8');
  await message.channel.send({
    files: [{ attachment: fileBuffer, name: 'SPOILER_breakdown.txt' }]
  });
}

// ── Money/amount helpers (define ONCE) ──
function parseGpAmount(input) {
  if (!input) return NaN;
  const s = String(input).trim().toLowerCase().replace(/,/g, '');
  const m = /^([0-9]*\.?[0-9]+)\s*([kmb])?$/.exec(s);
  if (!m) return NaN;
  const val = parseFloat(m[1]);
  const mult = m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : m[2] === 'b' ? 1_000_000_000 : 1;
  return Math.round(val * mult);
}

function formatGpShort(n) {
  if (n >= 1_000_000_000) return (n/1_000_000_000).toFixed(n % 1_000_000_000 ? 2 : 0).replace(/\.00$/,'') + 'b';
  if (n >= 1_000_000)     return (n/1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.00$/,'') + 'm';
  if (n >= 1_000)         return (n/1_000).toFixed(n % 1_000 ? 2 : 0).replace(/\.00$/,'') + 'k';
  return String(n);
}

// Renamed to avoid any collision
function usdToCents(usd) {
  const s = String(usd).trim().replace(',', '.');
  const v = Number(s);
  if (!isFinite(v)) return NaN;
  return Math.round(v * 100);
}

function formatUSD(cents) {
  return `$${(cents/100).toFixed(2)}`;
}


const fs = require('fs');
const path = require('path');
const DB_FILE = path.join(__dirname, 'customers.json');

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { customers: {} };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { customers: {} };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}


// ───────────────── Message handler ─────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const [cmd, ...args] = message.content.trim().split(/\s+/);
  const low = cmd.toLowerCase();

  try {
    switch (low) {
      // ───── BH Commands ─────
      case '!points':
      case '!pts':
      case '!p': {
        if (args.length < 3) {
          const usageEmbed = new EmbedBuilder()
            .setTitle('❌ Incorrect Usage')
            .setColor('#FF0000')
            .setDescription('`!points <startXP> <targetLevel> <skill> [combatLevel] [discountPercent]`');
          return message.channel.send({ embeds: [usageEmbed] });
        }
        const inputSkill = args[2];
        const skill = Object.keys(skillIcons).find(k => k.toLowerCase() === inputSkill.toLowerCase());
        if (!skill) {
          const list = Object.entries(skillIcons).map(([n, ico]) => `${ico} **${n}**`).join('\n');
          const invalid = new EmbedBuilder()
            .setTitle('❌ Unknown Skill')
            .setColor('#FF0000')
            .setDescription(`\`${inputSkill}\` isn’t a valid skill.`)
            .addFields({ name: 'Valid Skills', value: list });
          return message.channel.send({ embeds: [invalid] });
        }

        const startXP     = parseInt(args[0], 10);
        const targetLevel = parseInt(args[1], 10);
        const combatLevel = args[3] ? parseInt(args[3], 10) : NaN;
        const discountPct = args[4] ? parseInt(args[4], 10) : 0;

        await respondWithPoints(message, skill, startXP, targetLevel, combatLevel, discountPct);
        break;
      }

      case '!skills': {
        const list = Object.entries(skillIcons).map(([name, ico]) => `${ico} **${name}**`).join('\n');
        const skillsEmbed = new EmbedBuilder()
          .setTitle('📜 Available Skills')
          .setColor('#0099FF')
          .setDescription(list);
        return message.channel.send({ embeds: [skillsEmbed] });
      }

      case '!lvl': {
        if (args.length !== 2) {
          const lvlUsage = new EmbedBuilder()
            .setTitle('❌ Incorrect Usage')
            .setColor('#FF0000')
            .setDescription('`!lvl <startXP> <targetLevel>`');
          return message.channel.send({ embeds: [lvlUsage] });
        }
        const sx = parseInt(args[0], 10);
        const tl = parseInt(args[1], 10);
        const cl = getLevel(sx);
        const xpTL = getXPForLevel(tl);

        if (sx >= xpTL) {
          const alreadyEmbed = new EmbedBuilder()
            .setTitle('ℹ️ Already Enough XP')
            .setColor('#FFCC00')
            .setDescription(`You’re already level **${cl}** (${sx.toLocaleString()} XP), which is enough for level **${tl}**.`);
          return message.channel.send({ embeds: [alreadyEmbed] });
        }

        const diff = xpTL - sx;
        const diffEmbed = new EmbedBuilder()
          .setTitle('📈 XP Difference')
          .setColor('#00CC66')
          .setDescription(
            `You’re level **${cl}** with **${sx.toLocaleString()} XP**.\n` +
            `You need **${diff.toLocaleString()} XP** to reach level **${tl}**.`
          );
        return message.channel.send({ embeds: [diffEmbed] });
      }

      // ───── Customer Portal Commands ─────
 case '!order': {
  // Usage: !order @User gp <amount> [points]
  //     or !order @User usd <amount> [points]
  const mention = message.mentions.users.first();
  const mode    = (args[1] || '').toLowerCase();   // "gp" or "usd"
  const amountS = args[2];
  const pointsS = args[3];

  // Validate
  if (!mention || !['gp','usd'].includes(mode) || !amountS) {
    const usage = new EmbedBuilder()
      .setTitle('❌ Incorrect Usage')
      .setColor('#FF0000')
      .setDescription([
        '`!order @User gp <gp_amount(k/m/b or number)> [pointsOrdered]`',
        '`!order @User usd <usd_amount> [pointsOrdered]`'
      ].join('\n'));
    return message.channel.send({ embeds: [usage] });
  }

  // Parse amount
  let gpDelta   = 0;
  let usdCents  = 0;
  if (mode === 'gp') {
    gpDelta = parseGpAmount(amountS);
    if (!Number.isFinite(gpDelta) || gpDelta <= 0) {
      const e = new EmbedBuilder().setTitle('❌ Invalid GP').setColor('#FF0000')
        .setDescription('Provide a GP amount like `1b`, `250m`, `12.5k`, or a number.');
      return message.channel.send({ embeds: [e] });
    }
	} else { // usd
	  usdCents = usdToCents(amountS);   // <-- renamed
	  if (!Number.isFinite(usdCents) || usdCents <= 0) {
		const e = new EmbedBuilder().setTitle('❌ Invalid USD').setColor('#FF0000')
		  .setDescription('Provide a USD amount like `200` or `200.50`.');
		return message.channel.send({ embeds: [e] });
	  }
	}

  // Optional points
  const pointsOrdered = pointsS ? parseInt(pointsS, 10) : 0;
  if (pointsS && (!Number.isFinite(pointsOrdered) || pointsOrdered < 0)) {
    const e = new EmbedBuilder().setTitle('❌ Invalid Points').setColor('#FF0000')
      .setDescription('`pointsOrdered` must be a non-negative integer.');
    return message.channel.send({ embeds: [e] });
  }

  // Load and update DB
  const db = loadDB();
  const id = mention.id;
  if (!db.customers[id]) {
    db.customers[id] = {
      id,
      tag: `${mention.username}#${mention.discriminator ?? '0000'}`,
      totalGp: 0,
      totalUsdCents: 0,
      totalPoints: 0,
      lastUpdated: Date.now()
    };
  }
  const c = db.customers[id];

  // Apply **only one** side depending on mode
  if (mode === 'gp') c.totalGp += gpDelta;
  if (mode === 'usd') c.totalUsdCents += usdCents;

  if (pointsOrdered) c.totalPoints += pointsOrdered;
  c.tag = `${mention.username}#${mention.discriminator ?? '0000'}`;
  c.lastUpdated = Date.now();
  saveDB(db);

  // Build confirmation embed
  const fields = [];
  fields.push({ name: 'Customer', value: `<@${id}>`, inline: true });
  if (mode === 'gp') {
    fields.push({ name: 'Order (GP)', value: `${formatGpShort(gpDelta)} (${gpDelta.toLocaleString()})`, inline: true });
  } else {
    fields.push({ name: 'Order (USD)', value: `${formatUSD(usdCents)}`, inline: true });
  }
  if (pointsOrdered) {
    fields.push({ name: 'Points (this order)', value: pointsOrdered.toLocaleString(), inline: true });
  }

  fields.push({
    name: 'Lifetime Totals',
    value: [
      `**GP:** ${formatGpShort(c.totalGp)} (${c.totalGp.toLocaleString()})`,
      `**USD:** ${formatUSD(c.totalUsdCents)}`,
      `**Points:** ${c.totalPoints.toLocaleString()}`
    ].join('\n')
  });

  const embed = new EmbedBuilder()
    .setTitle('✅ Order Recorded')
    .setColor('#00CC66')
    .addFields(fields)
    .setFooter({ text: 'Only one payment method per order (GP OR USD) — as quoted.' });

  return message.channel.send({ embeds: [embed] });
}

      // !orders @User [limit]
      case '!orders': {
        if (args.length < 1) {
          const e = new EmbedBuilder()
            .setTitle('❌ Incorrect Usage')
            .setColor('#FF0000')
            .setDescription('`!orders @User [limit]`');
          return message.channel.send({ embeds: [e] });
        }
        const userId = parseUserId(args[0]);
        const limit = Math.min(Math.max(parseInt(args[1] || '10', 10), 1), 25);

        const orders = STMT.listOrders.all(userId, limit);
        if (!orders.length) {
          const e = new EmbedBuilder()
            .setTitle('📦 No Orders Found')
            .setColor('#666666')
            .setDescription(`No orders for <@${userId}>.`);
          return message.channel.send({ embeds: [e] });
        }
        const subtotalGp = orders.reduce((s, o) => s + o.gp_amount, 0);
        const subtotalUsd = orders.reduce((s, o) => s + o.fiat_amount, 0);

        const lines = orders.map(o => {
          const pointsText = o.note ? ` | **Points:** ${fmtInt(Number(o.note))}` : '';
          return `• **GP:** ${formatGpShort(o.gp_amount)} (${fmtInt(o.gp_amount)}) | **USD:** ${moneyStr(o.fiat_amount)}${pointsText} | **When:** ${o.created_at}`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`🧾 Recent Orders for ${message.guild?.members.cache.get(userId)?.user?.tag || '@user'}`)
          .setColor('#00AAFF')
          .setDescription(lines)
          .addFields(
            { name: 'Subtotal GP', value: `${formatGpShort(subtotalGp)} (${fmtInt(subtotalGp)})`, inline: true },
            { name: 'Subtotal USD', value: moneyStr(subtotalUsd), inline: true }
          );
        return message.channel.send({ embeds: [embed] });
      }

      // !quote @User <gp> <usd> [pointsOrdered]
      case '!quote': {
        if (args.length < 3) {
          const e = new EmbedBuilder()
            .setTitle('❌ Incorrect Usage')
            .setColor('#FF0000')
			.setDescription('`!order @User <gp_amount(k/m/b or number)> <usd_amount> [pointsOrdered]`');
          return message.channel.send({ embeds: [e] });
        }

        const userId = parseUserId(args[0]);
        const gp = parseGpAmount(args[1]);
        const usdCents = toCents(args[2]);
        const pointsOrdered = args[3] ? parseInt(args[3], 10) : NaN;
        const note = Number.isFinite(pointsOrdered) ? `${pointsOrdered}` : null;

        if (!userId || isNaN(gp) || isNaN(usdCents)) {
          const e = new EmbedBuilder()
            .setTitle('❌ Invalid Arguments')
            .setColor('#FF0000')
            .setDescription('`!quote @User <gp_amount> <usd_amount> [pointsOrdered]`');
          return message.channel.send({ embeds: [e] });
        }

        const now = nowISO();
        STMT.addQuote.run(userId, gp, usdCents, note, now);

        const embed = new EmbedBuilder()
          .setTitle('📝 Quote Saved')
          .setColor('#8A2BE2')
          .setDescription(`Quote for <@${userId}> recorded (does not affect lifetime totals).`)
          .addFields(
            { name: 'GP (quote)', value: `${formatGpShort(gp)} (${fmtInt(gp)})`, inline: true },
            { name: 'USD (quote)', value: moneyStr(usdCents), inline: true },
            { name: 'Points Ordered', value: note ? fmtInt(Number(note)) : '—', inline: true }
          );
        return message.channel.send({ embeds: [embed] });
      }

      // !quotes @User [limit]
      case '!quotes': {
        if (args.length < 1) {
          const e = new EmbedBuilder()
            .setTitle('❌ Incorrect Usage')
            .setColor('#FF0000')
            .setDescription('`!quotes @User [limit]`');
          return message.channel.send({ embeds: [e] });
        }
        const userId = parseUserId(args[0]);
        const limit = Math.min(Math.max(parseInt(args[1] || '10', 10), 1), 25);

        const quotes = STMT.listQuotes.all(userId, limit);
        if (!quotes.length) {
          const e = new EmbedBuilder()
            .setTitle('🗒️ No Quotes Found')
            .setColor('#666666')
            .setDescription(`No quotes for <@${userId}>.`);
          return message.channel.send({ embeds: [e] });
        }
        const subtotalGp = quotes.reduce((s, o) => s + o.gp_amount, 0);
        const subtotalUsd = quotes.reduce((s, o) => s + o.fiat_amount, 0);

        const lines = quotes.map(o => {
          const pointsText = o.note ? ` | **Points:** ${fmtInt(Number(o.note))}` : '';
          return `• **GP:** ${formatGpShort(o.gp_amount)} (${fmtInt(o.gp_amount)}) | **USD:** ${moneyStr(o.fiat_amount)}${pointsText} | **When:** ${o.created_at}`;
        }).join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`🗂️ Recent Quotes for ${message.guild?.members.cache.get(userId)?.user?.tag || '@user'}`)
          .setColor('#8A2BE2')
          .setDescription(lines)
          .addFields(
            { name: 'Subtotal GP (quotes)', value: `${formatGpShort(subtotalGp)} (${fmtInt(subtotalGp)})`, inline: true },
            { name: 'Subtotal USD (quotes)', value: moneyStr(subtotalUsd), inline: true }
          );
        return message.channel.send({ embeds: [embed] });
      }

      // !customer @User  /  !lifetime @User
      case '!customer':
      case '!lifetime': {
        if (args.length < 1) {
          const e = new EmbedBuilder()
            .setTitle('❌ Incorrect Usage')
            .setColor('#FF0000')
            .setDescription('`!customer @User` or `!lifetime @User`');
          return message.channel.send({ embeds: [e] });
        }
        const userId = parseUserId(args[0]);
        let c = STMT.getCustomer.get(userId);
        if (!c) {
          const now = nowISO();
          STMT.insertCustomer.run(userId, now, now);
          c = STMT.getCustomer.get(userId);
        }

        const avgGp   = c.orders_count ? Math.floor(c.total_gp / c.orders_count) : 0;
        const avgUsdC = c.orders_count ? Math.floor(c.total_fiat / c.orders_count) : 0;

        const embed = new EmbedBuilder()
          .setTitle(`👤 Customer Lifetime — ${message.guild?.members.cache.get(userId)?.user?.tag || '@user'}`)
          .setColor('#2ECC71')
          .addFields(
            { name: 'Lifetime GP', value: `${formatGpShort(c.total_gp)} (${fmtInt(c.total_gp)})`, inline: true },
            { name: 'Lifetime USD', value: moneyStr(c.total_fiat), inline: true },
            { name: 'Orders', value: fmtInt(c.orders_count), inline: true },
            { name: 'Avg GP / Order', value: `${formatGpShort(avgGp)} (${fmtInt(avgGp)})`, inline: true },
            { name: 'Avg USD / Order', value: moneyStr(avgUsdC), inline: true },
            { name: 'First Seen', value: c.created_at, inline: false }
          );
        return message.channel.send({ embeds: [embed] });
      }

      case '!help': {
        const helpEmbed = new EmbedBuilder()
          .setTitle('💀 BH XP Bot Help')
          .setColor('#00AAFF')
          .setDescription([
            '`!points <startXP> <targetLevel> <skill> [combatLevel] [discountPercent]` → simulate BH token usage & XP gains',
            '`!lvl    <startXP> <targetLevel>`                          → XP difference',
            '`!skills`                                                  → list valid skills',
            '',
            '**Customer Portal**',
            '`!order  @User <gp> <usd> [pointsOrdered]`  → log an order (updates lifetime totals)',
            '`!orders @User [limit]`                     → recent orders',
            '`!quote  @User <gp> <usd> [pointsOrdered]`  → save a quote (no lifetime update)',
            '`!quotes @User [limit]`                     → recent quotes',
            '`!customer @User` / `!lifetime @User`       → lifetime summary'
          ].join('\n'));
        return message.channel.send({ embeds: [helpEmbed] });
      }
    }
  } catch (err) {
    console.error('Unhandled command error:', err);
    const e = new EmbedBuilder()
      .setTitle('❌ Error')
      .setColor('#FF0000')
      .setDescription('An unexpected error occurred.');
    return message.channel.send({ embeds: [e] });
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  require('http')
    .createServer((_, res) => res.end('OK'))
    .listen(process.env.PORT || 3000);
});

client.login(process.env.BOT_TOKEN);
