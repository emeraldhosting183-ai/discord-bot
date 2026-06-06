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

const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const MC_API_URL = process.env.MC_API_URL || "";
const MC_API_SECRET = process.env.MC_API_SECRET || "";

const LOGIN_CONFIRM_TIMEOUT_MS = 60_000;
const pendingLogins = new Map();

// ── ПРИВЯЗАННЫЕ АККАУНТЫ (хранилище ник <-> discordId) ───────────────────
// Заполняется когда Minecraft-сервер шлёт POST /link { discordId, mcNick }
const linkedAccounts = new Map(); // discordId → mcNick
const linkedByNick   = new Map(); // mcNick → discordId

// ── ЛС-СООБЩЕНИЯ ─────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.guild) return;

  const text    = message.content.trim();
  const userId  = message.author.id;
  const mcNick  = linkedAccounts.get(userId);

  // ── Команды управления аккаунтом (только для привязанных) ──────────────

  // !кик / !kick
  if (text === "!кик" || text === "!kick") {
    if (!mcNick) {
      return message.reply({ embeds: [embedNotLinked()] });
    }
    const kicked = await kickPlayer(mcNick);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(kicked ? 0xED4245 : 0x99AAB5)
          .setTitle(kicked ? "✅ Персонаж кикнут" : "ℹ Персонаж не онлайн")
          .setDescription(
            kicked
              ? `Твой персонаж **\`${mcNick}\`** был выброшен с сервера.`
              : `Персонаж **\`${mcNick}\`** сейчас не на сервере.`
          )
      ]
    });
  }

  // !отвязать / !unlink
  if (text === "!отвязать" || text === "!unlink") {
    if (!mcNick) {
      return message.reply({ embeds: [embedNotLinked()] });
    }
    await unlinkAccount(userId, mcNick);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle("🔓 Аккаунт отвязан")
          .setDescription(
            `Связь между Discord и **\`${mcNick}\`** разорвана.\n\n` +
            "Чтобы привязать снова — зайди в игру и напиши `/link`."
          )
      ]
    });
  }

  // !пароль <новый> / !password <новый>
  if (text.startsWith("!пароль ") || text.startsWith("!password ")) {
    if (!mcNick) {
      return message.reply({ embeds: [embedNotLinked()] });
    }
    const parts   = text.split(" ");
    const newPass = parts[1];

    if (!newPass || newPass.length < 6) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle("❌ Пароль слишком короткий")
            .setDescription("Минимальная длина пароля — **6 символов**.")
        ]
      });
    }
    if (newPass.length > 30) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle("❌ Пароль слишком длинный")
            .setDescription("Максимальная длина пароля — **30 символов**.")
        ]
      });
    }

    const changed = await changePassword(mcNick, newPass);
    await message.delete().catch(() => {});
    return message.author.send({
      embeds: [
        new EmbedBuilder()
          .setColor(changed ? 0x57F287 : 0xED4245)
          .setTitle(changed ? "✅ Пароль изменён" : "❌ Ошибка смены пароля")
          .setDescription(
            changed
              ? `Пароль для **\`${mcNick}\`** успешно изменён.\n⚠ Сообщение с паролем удалено из чата.`
              : "Не удалось изменить пароль. Проверь, что сервер онлайн."
          )
      ]
    });
  }

  // !помощь / !help
  if (text === "!помощь" || text === "!help") {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("📋 Управление аккаунтом")
          .setDescription(mcNick ? `Привязан: **\`${mcNick}\`**` : "⚠ Аккаунт не привязан")
          .addFields(
            { name: "`!кик`",              value: "Выбросить своего персонажа с сервера" },
            { name: "`!отвязать`",         value: "Отвязать Discord от Minecraft аккаунта" },
            { name: "`!пароль НовыйПароль`", value: "Сменить пароль AuthMe (сообщение удалится автоматически)" },
            { name: "`!помощь`",           value: "Показать это меню" },
          )
          .setFooter({ text: "Команды работают только в ЛС с ботом" })
      ]
    });
  }

  // ── Верификация — код от DiscordSRV ────────────────────────────────────
  const codeMatch = text.match(/^[a-zA-Z0-9]{3,10}$/);
  if (codeMatch) {
    const code = text;
    return message.reply({
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
  }

  // ── Приветствие / инструкция ────────────────────────────────────────────
  return message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("🔗 Управление аккаунтом")
        .setDescription(
          mcNick
            ? `Твой аккаунт: **\`${mcNick}\`**\n\nНапиши **\`!помощь\`** для списка команд.`
            : "Чтобы привязать свой Minecraft аккаунт:\n\n" +
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
    return false;
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

    setTimeout(async () => {
      if (pendingLogins.has(discordUserId)) {
        pendingLogins.delete(discordUserId);
        await msg.edit({
          embeds: [
            new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle("⏰ Время вышло")
              .setDescription(`Не получили ответа — игрок **\`${mcNick}\`** кикнут с сервера.`)
          ],
          components: []
        }).catch(() => {});
        resolve(false);
      }
    }, LOGIN_CONFIRM_TIMEOUT_MS);
  });
}

// ── HTTP-СЕРВЕР для вебхуков от Minecraft ────────────────────────────────

const http = require("http");

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }

  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", async () => {
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400); return res.end("Bad JSON"); }

    if (WEBHOOK_SECRET && data.secret !== WEBHOOK_SECRET) {
      res.writeHead(403); return res.end("Forbidden");
    }

    // POST /login — игрок зашёл
    if (req.url === "/login") {
      const { discordId, mcNick } = data;
      if (!discordId || !mcNick) { res.writeHead(400); return res.end("Missing fields"); }

      res.writeHead(200); res.end("OK");

      const confirmed = await askLoginConfirm(discordId, mcNick);
      if (!confirmed) {
        await kickPlayer(mcNick);
      }
      return;
    }

    // POST /link — аккаунт привязан (Skript шлёт после события DiscordSRV)
    if (req.url === "/link") {
      const { discordId, mcNick } = data;
      if (!discordId || !mcNick) { res.writeHead(400); return res.end("Missing fields"); }

      linkedAccounts.set(discordId, mcNick);
      linkedByNick.set(mcNick.toLowerCase(), discordId);

      console.log(`[Link] ${mcNick} <-> ${discordId}`);
      res.writeHead(200); res.end("OK");

      try {
        const user = await client.users.fetch(discordId);
        const dm   = await user.createDM();
        await dm.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle("✅ Аккаунт привязан!")
              .setDescription(
                `Minecraft ник **\`${mcNick}\`** успешно привязан к твоему Discord.\n\n` +
                "Теперь ты можешь управлять аккаунтом прямо здесь в ЛС.\n" +
                "Напиши **`!помощь`** чтобы увидеть доступные команды."
              )
          ]
        });
      } catch (e) {
        console.error("[Link] Не удалось отправить ЛС:", e.message);
      }
      return;
    }

    // POST /unlink — аккаунт отвязан
    if (req.url === "/unlink") {
      const { discordId, mcNick } = data;
      if (discordId) linkedAccounts.delete(discordId);
      if (mcNick)   linkedByNick.delete(mcNick.toLowerCase());
      res.writeHead(200); res.end("OK");
      return;
    }

    res.writeHead(404); res.end("Not found");
  });
});

server.listen(WEBHOOK_PORT, () => {
  console.log(`[Webhook] HTTP сервер слушает порт ${WEBHOOK_PORT}`);
});

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───────────────────────────────────────────────

async function kickPlayer(mcNick) {
  if (!MC_API_URL) {
    console.warn(`[Kick] MC_API_URL не задан — кик ${mcNick} пропущен`);
    return false;
  }
  try {
    const resp = await fetch(`${MC_API_URL}/kick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, reason: "Вход не подтверждён в Discord" }),
    });
    console.log(`[Kick] ${mcNick} — статус: ${resp.status}`);
    return resp.ok;
  } catch (e) {
    console.error(`[Kick] Ошибка кика ${mcNick}:`, e.message);
    return false;
  }
}

async function changePassword(mcNick, newPass) {
  if (!MC_API_URL) {
    console.warn(`[Password] MC_API_URL не задан`);
    return false;
  }
  try {
    const resp = await fetch(`${MC_API_URL}/changepassword`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, password: newPass }),
    });
    console.log(`[Password] ${mcNick} — статус: ${resp.status}`);
    return resp.ok;
  } catch (e) {
    console.error(`[Password] Ошибка:`, e.message);
    return false;
  }
}

async function unlinkAccount(discordId, mcNick) {
  linkedAccounts.delete(discordId);
  linkedByNick.delete(mcNick.toLowerCase());

  if (!MC_API_URL) return;
  try {
    await fetch(`${MC_API_URL}/unlink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, discordId }),
    });
  } catch (e) {
    console.error(`[Unlink] Ошибка:`, e.message);
  }
}

function embedNotLinked() {
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle("❌ Аккаунт не привязан")
    .setDescription(
      "Твой Discord не привязан к Minecraft аккаунту.\n\n" +
      "Зайди на сервер и напиши `/link` чтобы получить код привязки."
    );
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
        )
        .setFooter({ text: "Управление аккаунтом — в ЛС с ботом (!помощь)" });
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

  await handleQuestionnaire(interaction);

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
