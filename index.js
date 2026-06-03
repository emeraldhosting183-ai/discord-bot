const {
  Client, GatewayIntentBits, Events, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");

const { initQuestionnaire, handleQuestionnaire } = require('./questionnaire');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID || "";

if (!TOKEN) throw new Error("DISCORD_TOKEN не задан");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],
});

let botClosed = false;
const CLOSED_MESSAGE = "🔒 Бот временно закрыт\n\nМы готовим что-то новое — бот будет недоступен до релиза.";
function isOwner(userId) { return OWNER_ID && userId === OWNER_ID; }

// ── ВЕРИФИКАЦИЯ ЧЕРЕЗ ЛС ───────────────────────────────────────────────────
//
// Флоу:
//  1. Участник пишет боту в ЛС что угодно (или команду /верификация)
//  2. Бот объясняет: зайди в игру, введи /link, получи код, пришли его сюда
//  3. Участник присылает код — бот отвечает: введи /discord verify КОД в игре
//
// При каждом входе в игру (DiscordSRV HTTP-вебхук POST /login):
//  1. Бот находит Discord-аккаунт игрока по нику (через linkedAccounts)
//  2. Пишет в ЛС кнопки "Да, это я" / "Нет, не я"
//  3. "Нет" или таймаут (60 сек) → POST /kick на сервер Minecraft
//
// ── НАСТРОЙКИ ─────────────────────────────────────────────────────────────

// ID HTTP-порта для вебхуков от DiscordSRV (нужен http сервер ниже)
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000;
// Секрет для проверки запросов от Minecraft-сервера
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
// URL RCON или HTTP API твоего Minecraft сервера для кика
// Пример: http://localhost:4567  (если используешь WebAPI плагин)
const MC_API_URL = process.env.MC_API_URL || "";
const MC_API_SECRET = process.env.MC_API_SECRET || "";

// Таймаут подтверждения входа (миллисекунды)
const LOGIN_CONFIRM_TIMEOUT_MS = 60_000;

// Map: discordUserId → { mcNick, resolve } — ожидающие подтверждения
const pendingLogins = new Map();

// ── ВЕРИФИКАЦИЯ — обработка ЛС ────────────────────────────────────────────

// Когда участник пишет боту в ЛС — показываем инструкцию
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  // Только ЛС (DM)
  if (message.guild) return;

  const text = message.content.trim();

  // Если прислал код верификации (числовой или короткая строка)
  // DiscordSRV генерирует коды вида: 12345 или abcd1
  const codeMatch = text.match(/^[a-zA-Z0-9]{3,10}$/);
  if (codeMatch) {
    const code = text;
    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle("✅ Почти готово!")
          .setDescription(
            `Твой код: **\`${code}\`**\n\n` +
            "Зайди на Minecraft сервер и введи в чат:\n" +
            `\`/discord verify ${code}\`` +
            "\n\nПосле этого DiscordSRV автоматически подтвердит тебя!"
          )
          .setFooter({ text: "Это сообщение видишь только ты" })
      ]
    });
    return;
  }

  // Иначе — показываем инструкцию как получить код
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("🔗 Верификация через Minecraft")
        .setDescription(
          "Чтобы привязать свой аккаунт:\n\n" +
          "**1.** Зайди на наш Minecraft сервер\n" +
          "**2.** Введи команду `/link` — получишь код\n" +
          "**3.** Пришли этот код сюда в ЛС\n\n" +
          "Бот подскажет дальше!"
        )
        .setFooter({ text: "Если уже есть код — просто пришли его сюда" })
    ]
  });
});

// ── ПОДТВЕРЖДЕНИЕ ВХОДА — кнопки ─────────────────────────────────────────

async function askLoginConfirm(discordUserId, mcNick) {
  let dmChannel;
  try {
    const user = await client.users.fetch(discordUserId);
    dmChannel = await user.createDM();
  } catch {
    console.error(`[Login] Не удалось открыть ЛС с ${discordUserId}`);
    return false; // не смогли — пускаем (или кикать — решай сам, меняй на true)
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`login_yes_${discordUserId}`)
      .setLabel("✅ Да, это я")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`login_no_${discordUserId}`)
      .setLabel("❌ Нет, не я")
      .setStyle(ButtonStyle.Danger),
  );

  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle("⚠️ Вход на сервер")
    .setDescription(
      `Кто-то заходит на сервер с ником **\`${mcNick}\`**.\n\n` +
      "Это ты?\n\n" +
      `_Если не ответишь за ${LOGIN_CONFIRM_TIMEOUT_MS / 1000} секунд — игрок будет кикнут._`
    )
    .setTimestamp();

  const msg = await dmChannel.send({ embeds: [embed], components: [row] });

  return new Promise((resolve) => {
    pendingLogins.set(discordUserId, { mcNick, resolve, msg });

    // Таймаут — кик
    setTimeout(async () => {
      if (pendingLogins.has(discordUserId)) {
        pendingLogins.delete(discordUserId);
        // Редактируем сообщение — убираем кнопки
        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle("⏰ Время вышло")
              .setDescription(`Не получили ответа — игрок **\`${mcNick}\`** кикнут с сервера.`)
          ],
          components: []
        }).catch(() => {});
        resolve(false); // кик
      }
    }, LOGIN_CONFIRM_TIMEOUT_MS);
  });
}

// ── HTTP-СЕРВЕР для вебхуков от DiscordSRV ────────────────────────────────
//
// DiscordSRV не умеет слать вебхуки напрямую, поэтому используй
// плагин-мост (например DiscordSRV-Addon или собственный Paper плагин)
// который при событии JOIN шлёт POST /login { secret, discordId, mcNick }
// При необходимости кика — бот шлёт POST на MC_API_URL/kick { secret, nick }

const http = require("http");

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); return res.end("Bad JSON"); }

    // Проверка секрета
    if (WEBHOOK_SECRET && data.secret !== WEBHOOK_SECRET) {
      res.writeHead(403); return res.end("Forbidden");
    }

    // POST /login — игрок зашёл
    if (req.url === "/login") {
      const { discordId, mcNick } = data;
      if (!discordId || !mcNick) { res.writeHead(400); return res.end("Missing fields"); }

      res.writeHead(200); res.end("OK"); // отвечаем сразу, не ждём

      const confirmed = await askLoginConfirm(discordId, mcNick);
      if (!confirmed) {
        await kickPlayer(mcNick);
      }
      return;
    }

    res.writeHead(404); res.end("Not found");
  });
});

server.listen(WEBHOOK_PORT, () => {
  console.log(`[Webhook] HTTP сервер слушает порт ${WEBHOOK_PORT}`);
});

// ── КИК ИГРОКА ────────────────────────────────────────────────────────────

async function kickPlayer(mcNick) {
  if (!MC_API_URL) {
    return console.warn(`[Kick] MC_API_URL не задан — кик ${mcNick} пропущен`);
  }
  try {
    const resp = await fetch(`${MC_API_URL}/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, reason: "Вход не подтверждён в Discord" }),
    });
    console.log(`[Kick] ${mcNick} — статус: ${resp.status}`);
  } catch (e) {
    console.error(`[Kick] Ошибка кика ${mcNick}:`, e.message);
  }
}

// ── Slash команды ─────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder().setName("пинг").setDescription("Проверить работу бота"),
  new SlashCommandBuilder().setName("помощь").setDescription("Список команд"),
  new SlashCommandBuilder().setName("сервер").setDescription("Инфо о сервере"),
  new SlashCommandBuilder().setName("закрыть").setDescription("🔒 Закрыть/открыть бота (только владелец)"),
  new SlashCommandBuilder().setName("тикет-настройка").setDescription("🎫 Отправить панель тикетов в этот канал (только владелец)"),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  if (!CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash команды зарегистрированы");
  } catch (e) { console.error(e); }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Бот запущен как ${c.user.tag}`);
  await registerCommands();
  await initQuestionnaire(client);
});

client.on(Events.InteractionCreate, async (interaction) => {

  // ── Кнопки подтверждения входа ────────────────────────────────────────
  if (interaction.isButton()) {
    if (interaction.customId.startsWith("login_yes_") || interaction.customId.startsWith("login_no_")) {
      const discordUserId = interaction.customId.replace("login_yes_", "").replace("login_no_", "");
      const isYes = interaction.customId.startsWith("login_yes_");
      const pending = pendingLogins.get(discordUserId);

      if (!pending) {
        return interaction.update({
          embeds: [new EmbedBuilder().setColor(0x99AAB5).setDescription("⏰ Время ответа истекло.")],
          components: []
        });
      }

      pendingLogins.delete(discordUserId);

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(isYes ? 0x57F287 : 0xED4245)
            .setTitle(isYes ? "✅ Вход подтверждён" : "❌ Вход отклонён")
            .setDescription(
              isYes
                ? `Добро пожаловать на сервер, **\`${pending.mcNick}\`**!`
                : `Игрок **\`${pending.mcNick}\`** будет кикнут с сервера.`
            )
        ],
        components: []
      });

      pending.resolve(isYes);
      return;
    }
  }

  // ── Slash команды ──────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const cmd = interaction.commandName;

    if (botClosed && !(cmd === "закрыть" && isOwner(userId))) {
      return interaction.reply({ content: CLOSED_MESSAGE, flags: 64 });
    }

    if (cmd === "пинг") {
      await interaction.reply(`🏓 Понг! Задержка: ${client.ws.ping}ms`);

    } else if (cmd === "помощь") {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("📋 Команды бота")
        .addFields(
          { name: "/пинг", value: "Проверить работу бота" },
          { name: "/сервер", value: "Информация о сервере" },
          { name: "/помощь", value: "Этот список" },
        );
      await interaction.reply({ embeds: [embed] });

    } else if (cmd === "сервер") {
      const guild = interaction.guild;
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(guild.name)
        .addFields(
          { name: "👥 Участников", value: `${guild.memberCount}`, inline: true },
          { name: "📅 Создан", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
        )
        .setThumbnail(guild.iconURL());
      await interaction.reply({ embeds: [embed] });

    } else if (cmd === "закрыть") {
      if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", flags: 64 });
      botClosed = !botClosed;
      await interaction.reply({ content: botClosed ? "🔒 Бот закрыт." : "🔓 Бот открыт.", flags: 64 });

    } else if (cmd === "тикет-настройка") {
      if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", flags: 64 });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("🎫 Техническая поддержка")
        .setDescription(
          "Если у вас возникли вопросы или проблемы — нажмите на кнопку ниже, чтобы создать приватный тикет.\n\n" +
          "Администрация ответит вам в ближайшее время."
        )
        .setFooter({ text: "Тикет виден только вам и администрации" });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_create")
          .setLabel("📩 Создать тикет")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: "✅ Панель тикетов отправлена!", flags: 64 });
    }
  }

  // ── Анкета ────────────────────────────────────────────────────────────
  await handleQuestionnaire(interaction);

  // ── Тикеты ────────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_create") {
    const guild = interaction.guild;
    const user = interaction.user;

    const existing = guild.channels.cache.find(
      ch => ch.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}` ||
            ch.topic === `ticket:${user.id}`
    );
    if (existing) {
      return interaction.reply({ content: `У вас уже есть открытый тикет: ${existing}`, flags: 64 });
    }

    const category = guild.channels.cache.find(
      ch => ch.type === 4 && ch.name.toLowerCase().includes("поддержк")
    );
    const adminRole = guild.roles.cache.find(
      r => r.name === "ГЛ.АДМИНИСТРАЦИЯ" || r.name === "Senior Moderators" || r.permissions.has("Administrator")
    );

    const permissionOverwrites = [
      { id: guild.id, deny: ["ViewChannel"] },
      { id: user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
    ];
    if (adminRole) {
      permissionOverwrites.push({
        id: adminRole.id,
        allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"]
      });
    }

    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)}`,
        type: 0,
        topic: `ticket:${user.id}`,
        parent: category?.id ?? null,
        permissionOverwrites,
      });
    } catch (e) {
      console.error("Ошибка создания тикет-канала:", e);
      return interaction.reply({ content: "❌ Не удалось создать тикет. Проверьте права бота.", flags: 64 });
    }

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("🎫 Тикет создан")
      .setDescription(`Добро пожаловать, ${user}!\n\nПожалуйста, опишите вашу проблему здесь.\nАдминистрация скоро ответит вам.`)
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("🔒 Закрыть тикет")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({ embeds: [welcomeEmbed], components: [closeRow] });
    await interaction.reply({ content: `✅ Ваш тикет создан: ${ticketChannel}`, flags: 64 });
  }

  if (interaction.isButton() && interaction.customId === "ticket_close") {
    const channel = interaction.channel;
    if (!channel.topic?.startsWith("ticket:") && !channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "❌ Это не тикет-канал.", flags: 64 });
    }
    await interaction.reply({ content: "🔒 Тикет закрывается, канал будет удалён через 5 секунд..." });
    setTimeout(() => channel.delete("Тикет закрыт").catch(console.error), 5000);
  }

});

client.login(TOKEN);
