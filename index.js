const {
  Client, GatewayIntentBits, Events, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require("discord.js");
const { Partials } = require("discord.js");

const { initQuestionnaire, handleQuestionnaire } = require('./questionnaire');
const SftpClient = require('ssh2-sftp-client');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID || "";
const MC_API_URL = process.env.MC_API_URL || "";
const MC_API_SECRET = process.env.MC_API_SECRET || "";
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const LOGIN_CONFIRM_TIMEOUT_MS = 60_000;
const MAX_ACCOUNTS = 3;

const SFTP_HOST     = process.env.SFTP_HOST     || "";
const SFTP_PORT     = parseInt(process.env.SFTP_PORT || "22");
const SFTP_USER     = process.env.SFTP_USER     || "";
const SFTP_PASS     = process.env.SFTP_PASS     || "";
const SFTP_AOF_PATH = process.env.SFTP_AOF_PATH || "/plugins/DiscordSRV/accounts.aof";
const SFTP_SYNC_MS  = parseInt(process.env.SFTP_SYNC_MS || "5000");

if (!TOKEN) throw new Error("DISCORD_TOKEN не задан");

const client = new Client({
  partials: [Partials.Channel, Partials.Message],
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

// Хранилище привязок и настроек
// linkedAccounts: discordId → string[]  (массив ников, макс MAX_ACCOUNTS)
const linkedAccounts = new Map();
const notifyEnabled = new Map();  // discordId → true/false
const pendingLogins = new Map();  // discordId → { mcNick, resolve, msg }

// ── ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ───────────────────────────────────────────────

function getAccounts(discordId) {
  return linkedAccounts.get(discordId) || [];
}

function addAccount(discordId, mcNick) {
  const accounts = getAccounts(discordId);
  if (accounts.includes(mcNick)) return false; // уже есть
  if (accounts.length >= MAX_ACCOUNTS) return false; // лимит
  accounts.push(mcNick);
  linkedAccounts.set(discordId, accounts);
  return true;
}

function removeAccount(discordId, mcNick) {
  const accounts = getAccounts(discordId);
  const idx = accounts.indexOf(mcNick);
  if (idx === -1) return false;
  accounts.splice(idx, 1);
  if (accounts.length === 0) {
    linkedAccounts.delete(discordId);
  } else {
    linkedAccounts.set(discordId, accounts);
  }
  return true;
}

// ── ГЛАВНОЕ МЕНЮ ─────────────────────────────────────────────────────────

function getMenuEmbed(discordId) {
  const accounts = getAccounts(discordId);
  const notify = notifyEnabled.get(discordId) ?? true;

  let accountsLine;
  if (accounts.length === 0) {
    accountsLine = "❌ Нет привязанных аккаунтов";
  } else {
    accountsLine = accounts.map((n, i) => `**${i + 1}.** \`${n}\``).join("\n");
  }

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("🎮 Управление аккаунтом")
    .setDescription(accountsLine)
    .addFields(
      { name: "🔔 Уведомления о входе", value: notify ? "Включены" : "Выключены", inline: true },
      { name: "📋 Слотов использовано", value: `${accounts.length} / ${MAX_ACCOUNTS}`, inline: true },
    )
    .setFooter({ text: "Используй кнопки ниже для управления" });
}

function getMenuRow(discordId) {
  const accounts = getAccounts(discordId);
  const notify = notifyEnabled.get(discordId) ?? true;
  const canLink = accounts.length < MAX_ACCOUNTS;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("btn_link")
      .setLabel("🔗 Привязать")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canLink),
    new ButtonBuilder()
      .setCustomId("btn_accounts")
      .setLabel("📋 Мои аккаунты")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(accounts.length === 0),
    new ButtonBuilder()
      .setCustomId("btn_notify")
      .setLabel(notify ? "🔕 Выкл. уведомления" : "🔔 Вкл. уведомления")
      .setStyle(notify ? ButtonStyle.Secondary : ButtonStyle.Success),
  );
}

// ── EMBED СПИСОК АККАУНТОВ ────────────────────────────────────────────────

function getAccountsEmbed(discordId) {
  const accounts = getAccounts(discordId);
  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle("📋 Привязанные аккаунты")
    .setDescription(
      accounts.length === 0
        ? "❌ Нет привязанных аккаунтов"
        : accounts.map((n, i) => `**${i + 1}.** \`${n}\``).join("\n")
    )
    .setFooter({ text: `Максимум ${MAX_ACCOUNTS} аккаунта • Нажми на кнопку аккаунта для управления` });
}

function getAccountsRows(discordId) {
  const accounts = getAccounts(discordId);
  const rows = [];

  // Ряд кнопок для каждого аккаунта (кик + отвязать)
  for (let i = 0; i < accounts.length; i++) {
    const nick = accounts[i];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`btn_kick_${i}`)
        .setLabel(`👢 Кик: ${nick}`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`btn_unlink_${i}`)
        .setLabel(`🔓 Отвязать: ${nick}`)
        .setStyle(ButtonStyle.Secondary),
    );
    rows.push(row);
  }

  // Кнопка «назад»
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("btn_back")
        .setLabel("◀ Назад")
        .setStyle(ButtonStyle.Primary),
    )
  );

  return rows;
}

// ── ЛС — показываем меню при любом сообщении ─────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.guild) return;

  const userId = message.author.id;

  await message.reply({
    embeds: [getMenuEmbed(userId)],
    components: [getMenuRow(userId)],
  });
});

// ── КНОПКИ ────────────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction) => {

  // Кнопки меню (только в ЛС)
  if (interaction.isButton() && !interaction.guild) {
    const userId = interaction.user.id;

    // ── Привязать ──
    if (interaction.customId === "btn_link") {
      const accounts = getAccounts(userId);
      if (accounts.length >= MAX_ACCOUNTS) {
        return interaction.reply({ content: `❌ Достигнут лимит: максимум **${MAX_ACCOUNTS}** аккаунта на один Discord.`, flags: 64 });
      }
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("🔗 Как привязать аккаунт")
            .setDescription(
              "**1.** Зайди на Minecraft сервер\n" +
              "**2.** Напиши в чате `/discord link`\n" +
              "**3.** Получишь код — пришли его сюда в ЛС\n\n" +
              "Бот автоматически подтвердит привязку!\n\n" +
              `> Слотов использовано: **${accounts.length} / ${MAX_ACCOUNTS}**`
            )
        ],
        flags: 64,
      });
      return;
    }

    // ── Мои аккаунты ──
    if (interaction.customId === "btn_accounts") {
      await interaction.update({
        embeds: [getAccountsEmbed(userId)],
        components: getAccountsRows(userId),
      });
      return;
    }

    // ── Назад (из вкладки аккаунтов) ──
    if (interaction.customId === "btn_back") {
      await interaction.update({
        embeds: [getMenuEmbed(userId)],
        components: [getMenuRow(userId)],
      });
      return;
    }

    // ── Кик конкретного аккаунта: btn_kick_0, btn_kick_1, btn_kick_2 ──
    if (interaction.customId.startsWith("btn_kick_")) {
      const idx = parseInt(interaction.customId.replace("btn_kick_", ""), 10);
      const accounts = getAccounts(userId);
      const rawNick = accounts[idx];
      if (!rawNick) return interaction.reply({ content: "❌ Аккаунт не найден.", flags: 64 });

      await interaction.deferReply({ flags: 64 });

      // Если вдруг в списке оказался UUID — резолвим в ник
      const mcNick = await resolveNick(rawNick);

      let kicked = false;
      if (MC_API_URL) {
        try {
          const resp = await fetch(`${MC_API_URL}/kick`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, reason: "Кик через Discord-бота" }),
          });
          kicked = resp.ok;
        } catch (e) {
          console.error("[Kick]", e.message);
        }
      }

      await interaction.editReply({
        content: kicked
          ? `✅ Персонаж **\`${mcNick}\`** кикнут с сервера.`
          : `ℹ Персонаж **\`${mcNick}\`** не онлайн или сервер недоступен.`,
      });
      return;
    }

    // ── Отвязать конкретный аккаунт: btn_unlink_0, btn_unlink_1, btn_unlink_2 ──
    if (interaction.customId.startsWith("btn_unlink_")) {
      const idx = parseInt(interaction.customId.replace("btn_unlink_", ""), 10);
      const accounts = getAccounts(userId);
      const mcNick = accounts[idx];
      if (!mcNick) return interaction.reply({ content: "❌ Аккаунт не найден.", flags: 64 });

      removeAccount(userId, mcNick);

      if (MC_API_URL) {
        fetch(`${MC_API_URL}/unlink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, discordId: userId }),
        }).catch(() => {});
      }

      // Обновляем вкладку аккаунтов (или возвращаемся в меню если стало пусто)
      const remaining = getAccounts(userId);
      if (remaining.length === 0) {
        await interaction.update({
          embeds: [getMenuEmbed(userId)],
          components: [getMenuRow(userId)],
        });
        await interaction.followUp({ content: `✅ Аккаунт **\`${mcNick}\`** отвязан.`, flags: 64 });
      } else {
        await interaction.update({
          embeds: [getAccountsEmbed(userId)],
          components: getAccountsRows(userId),
        });
        await interaction.followUp({ content: `✅ Аккаунт **\`${mcNick}\`** отвязан.`, flags: 64 });
      }
      return;
    }

    // ── Уведомления вкл/выкл ──
    if (interaction.customId === "btn_notify") {
      const current = notifyEnabled.get(userId) ?? true;
      notifyEnabled.set(userId, !current);

      await interaction.update({
        embeds: [getMenuEmbed(userId)],
        components: [getMenuRow(userId)],
      });
      return;
    }
  }

  // Кнопки подтверждения входа
  if (interaction.isButton() && (
    interaction.customId.startsWith("login_yes_") ||
    interaction.customId.startsWith("login_no_")
  )) {
    const discordUserId = interaction.customId
      .replace("login_yes_", "")
      .replace("login_no_", "");
    const isYes = interaction.customId.startsWith("login_yes_");
    const pending = pendingLogins.get(discordUserId);

    if (!pending) {
      return interaction.update({
        embeds: [new EmbedBuilder().setColor(0x99AAB5).setDescription("⏰ Время ответа истекло.")],
        components: [],
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
              ? `Добро пожаловать, **\`${pending.mcNick}\`**!`
              : `Игрок **\`${pending.mcNick}\`** будет кикнут.`
          )
      ],
      components: [],
    });

    pending.resolve(isYes);
    return;
  }

  // Slash команды
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const cmd = interaction.commandName;

    if (botClosed && !(cmd === "закрыть" && isOwner(userId))) {
      return interaction.reply({ content: CLOSED_MESSAGE, flags: 64 });
    }

    if (cmd === "пинг") {
      await interaction.reply(`🏓 Понг! Задержка: ${client.ws.ping}ms`);

    } else if (cmd === "помощь") {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("📋 Команды бота")
            .addFields(
              { name: "/пинг", value: "Проверить работу бота" },
              { name: "/сервер", value: "Информация о сервере" },
              { name: "/помощь", value: "Этот список" },
            )
            .setFooter({ text: "Управление аккаунтом — напиши боту в ЛС" })
        ]
      });

    } else if (cmd === "сервер") {
      const guild = interaction.guild;
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(guild.name)
            .addFields(
              { name: "👥 Участников", value: `${guild.memberCount}`, inline: true },
              { name: "📅 Создан", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
            )
            .setThumbnail(guild.iconURL())
        ]
      });

    } else if (cmd === "закрыть") {
      if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", flags: 64 });
      botClosed = !botClosed;
      await interaction.reply({ content: botClosed ? "🔒 Бот закрыт." : "🔓 Бот открыт.", flags: 64 });

    } else if (cmd === "тикет-настройка") {
      if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", flags: 64 });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_create")
          .setLabel("📩 Создать тикет")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("🎫 Техническая поддержка")
            .setDescription(
              "Если у вас возникли вопросы или проблемы — нажмите на кнопку ниже, чтобы создать приватный тикет.\n\n" +
              "Администрация ответит вам в ближайшее время."
            )
            .setFooter({ text: "Тикет виден только вам и администрации" })
        ],
        components: [row],
      });
      await interaction.reply({ content: "✅ Панель тикетов отправлена!", flags: 64 });
    }
  }

  await handleQuestionnaire(interaction);

  // Тикеты
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
      return interaction.reply({ content: "❌ Не удалось создать тикет. Проверьте права бота.", flags: 64 });
    }

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("🔒 Закрыть тикет")
        .setStyle(ButtonStyle.Danger)
    );

    await ticketChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle("🎫 Тикет создан")
          .setDescription(`Добро пожаловать, ${user}!\n\nПожалуйста, опишите вашу проблему здесь.\nАдминистрация скоро ответит вам.`)
          .setTimestamp()
      ],
      components: [closeRow],
    });
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

// ── HTTP СЕРВЕР ───────────────────────────────────────────────────────────

const http = require("http");

async function askLoginConfirm(discordUserId, mcNick) {
  let dmChannel;
  try {
    const user = await client.users.fetch(discordUserId);
    dmChannel = await user.createDM();
  } catch {
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

  const msg = await dmChannel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle("⚠️ Вход на сервер")
        .setDescription(
          `Кто-то заходит на сервер с ником **\`${mcNick}\`**.\n\n` +
          "Это ты?\n\n" +
          `_Если не ответишь за ${LOGIN_CONFIRM_TIMEOUT_MS / 1000} секунд — игрок будет кикнут._`
        )
        .setTimestamp()
    ],
    components: [row],
  });

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
              .setDescription(`Игрок **\`${mcNick}\`** кикнут с сервера.`)
          ],
          components: [],
        }).catch(() => {});
        resolve(false);
      }
    }, LOGIN_CONFIRM_TIMEOUT_MS);
  });
}

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

    if (req.url === "/login") {
      const { discordId, mcNick } = data;
      if (!discordId || !mcNick) { res.writeHead(400); return res.end("Missing fields"); }
      res.writeHead(200); res.end("OK");

      const notify = notifyEnabled.get(discordId) ?? true;
      if (notify) {
        // Проверяем что этот ник привязан к данному дискорд аккаунту
        const accounts = getAccounts(discordId);
        if (accounts.includes(mcNick)) {
          const confirmed = await askLoginConfirm(discordId, mcNick);
          if (!confirmed && MC_API_URL) {
            fetch(`${MC_API_URL}/kick`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ secret: MC_API_SECRET, nick: mcNick, reason: "Вход не подтверждён в Discord" }),
            }).catch(() => {});
          }
        }
      }
      return;
    }

    if (req.url === "/link") {
      const { discordId, mcNick } = data;
      if (!discordId || !mcNick) { res.writeHead(400); return res.end("Missing fields"); }

      const added = addAccount(discordId, mcNick);
      if (!added) {
        // Лимит или уже привязан
        res.writeHead(409); return res.end("Limit reached or already linked");
      }
      res.writeHead(200); res.end("OK");

      try {
        const user = await client.users.fetch(discordId);
        const dm = await user.createDM();
        const accounts = getAccounts(discordId);
        await dm.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle("✅ Аккаунт привязан!")
              .setDescription(
                `Minecraft ник **\`${mcNick}\`** привязан к твоему Discord.\n\n` +
                `Привязанные аккаунты (${accounts.length}/${MAX_ACCOUNTS}):\n` +
                accounts.map((n, i) => `**${i + 1}.** \`${n}\``).join("\n") + "\n\n" +
                "Используй кнопки ниже для управления аккаунтами."
              )
          ],
          components: [getMenuRow(discordId)],
        });
      } catch (e) {
        console.error("[Link] Не удалось отправить ЛС:", e.message);
      }
      return;
    }

    if (req.url === "/unlink") {
      const { discordId, mcNick } = data;
      if (discordId && mcNick) {
        removeAccount(discordId, mcNick);
      } else if (discordId) {
        // Отвязать все аккаунты
        linkedAccounts.delete(discordId);
      }
      res.writeHead(200); res.end("OK");
      return;
    }

    res.writeHead(404); res.end("Not found");
  });
});

server.listen(WEBHOOK_PORT, () => {
  console.log(`[Webhook] HTTP сервер слушает порт ${WEBHOOK_PORT}`);
});

// ── SLASH КОМАНДЫ ─────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder().setName("пинг").setDescription("Проверить работу бота"),
  new SlashCommandBuilder().setName("помощь").setDescription("Список команд"),
  new SlashCommandBuilder().setName("сервер").setDescription("Инфо о сервере"),
  new SlashCommandBuilder().setName("закрыть").setDescription("🔒 Закрыть/открыть бота (только владелец)"),
  new SlashCommandBuilder().setName("тикет-настройка").setDescription("🎫 Отправить панель тикетов (только владелец)"),
].map(cmd => cmd.toJSON());

async function registerCommands() {
  if (!CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash команды зарегистрированы");
  } catch (e) { console.error(e); }
}

// ── SFTP СИНХРОНИЗАЦИЯ accounts.aof ──────────────────────────────────────

// Парсим AOF: положительный id = привязка, отрицательный = отвязка
// Формат строки: "discordId uuid"
function parseAof(content) {
  const state = {}; // uuid → discordId
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) continue;
    const [rawId, uuid] = parts;
    const discordId = rawId.replace(/^-/, "");
    const isUnlink = rawId.startsWith("-");
    if (isUnlink) {
      if (state[uuid] === discordId) delete state[uuid];
    } else {
      state[uuid] = discordId;
    }
  }
  return state; // { uuid → discordId }
}

// uuid → ник кэш (заполняется из usercache.json по SFTP)
const uuidNickCache = {};

const SFTP_USERCACHE_PATH = process.env.SFTP_USERCACHE_PATH || "/usercache.json";

async function loadUsercache() {
  if (!SFTP_HOST || !SFTP_USER || !SFTP_PASS) return;
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host: SFTP_HOST, port: SFTP_PORT, username: SFTP_USER, password: SFTP_PASS, readyTimeout: 5000 });
    const buf = await sftp.get(SFTP_USERCACHE_PATH);
    const entries = JSON.parse(buf.toString("utf8"));
    for (const entry of entries) {
      if (entry.uuid && entry.name) {
        uuidNickCache[entry.uuid] = entry.name;
      }
    }
    console.log(`[usercache] Загружено ${Object.keys(uuidNickCache).length} записей`);
  } catch (e) {
    console.error("[usercache] Ошибка загрузки:", e.message);
  } finally {
    await sftp.end().catch(() => {});
  }
}

function getMcNick(uuid) {
  return uuidNickCache[uuid] || null;
}

// Вспомогательная: резолвит ник из аккаунтов — если вдруг там UUID, конвертирует
function looksLikeUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function resolveNick(str) {
  if (looksLikeUuid(str)) {
    return getMcNick(str) || str;
  }
  return str;
}

// Предыдущее состояние AOF { uuid → discordId }
let prevAofState = null;

async function syncAof() {
  if (!SFTP_HOST || !SFTP_USER || !SFTP_PASS) return;

  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: SFTP_HOST,
      port: SFTP_PORT,
      username: SFTP_USER,
      password: SFTP_PASS,
      readyTimeout: 5000,
    });

    const buf     = await sftp.get(SFTP_AOF_PATH);
    const content = buf.toString("utf8");
    const current = parseAof(content);

    // Первый запуск — просто запоминаем без отправки вебхуков
    if (prevAofState === null) {
      prevAofState = current;
      // Синхронизируем уже привязанные в linkedAccounts
      for (const [uuid, discordId] of Object.entries(current)) {
        const nick = await getMcNick(uuid);
        if (!nick) {
          console.warn(`[SFTP sync] Не удалось получить ник для UUID ${uuid}, пропускаем`);
          continue;
        }
        if (!getAccounts(discordId).includes(nick)) {
          addAccount(discordId, nick);
          console.log(`[SFTP sync] Восстановлена привязка: ${nick} → ${discordId}`);
        }
      }
      console.log(`[SFTP] Начальная синхронизация: ${Object.keys(current).length} привязок`);
      await sftp.end();
      return;
    }

    // Новые привязки
    for (const [uuid, discordId] of Object.entries(current)) {
      if (prevAofState[uuid] !== discordId) {
        const nick = await getMcNick(uuid);
        if (!nick) {
          console.warn(`[SFTP] Не удалось получить ник для UUID ${uuid}, пропускаем`);
          continue; // не сохраняем UUID как ник
        }
        const added = addAccount(discordId, nick);
        if (added) {
          console.log(`[SFTP] Новая привязка: ${nick} → ${discordId}`);
          // Уведомляем пользователя в ЛС
          try {
            const user = await client.users.fetch(discordId);
            const dm   = await user.createDM();
            const accounts = getAccounts(discordId);
            await dm.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x57F287)
                  .setTitle("✅ Аккаунт привязан!")
                  .setDescription(
                    `Minecraft ник **\`${nick}\`** привязан к твоему Discord.\n\n` +
                    `Привязанные аккаунты (${accounts.length}/${MAX_ACCOUNTS}):\n` +
                    accounts.map((n, i) => `**${i + 1}.** \`${n}\``).join("\n")
                  )
              ],
              components: [getMenuRow(discordId)],
            });
          } catch (e) {
            console.error("[SFTP] Не удалось отправить ЛС:", e.message);
          }
        }
      }
    }

    // Удалённые привязки
    for (const [uuid, discordId] of Object.entries(prevAofState)) {
      if (!current[uuid]) {
        const nick = uuidNickCache[uuid] || uuid;
        removeAccount(discordId, nick);
        console.log(`[SFTP] Отвязка: ${nick} → ${discordId}`);
      }
    }

    prevAofState = current;
  } catch (e) {
    console.error("[SFTP] Ошибка синхронизации:", e.message);
  } finally {
    await sftp.end().catch(() => {});
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Бот запущен как ${c.user.tag}`);
  await registerCommands();
  await initQuestionnaire(client);

  if (SFTP_HOST) {
    console.log(`[SFTP] Синхронизация каждые ${SFTP_SYNC_MS / 1000}с → ${SFTP_HOST}:${SFTP_PORT}`);
    await loadUsercache(); // загружаем usercache.json перед первой синхронизацией
    await syncAof();
    setInterval(async () => {
      await loadUsercache(); // обновляем кэш ников перед каждой проверкой AOF
      await syncAof();
    }, SFTP_SYNC_MS);
  } else {
    console.log("[SFTP] SFTP_HOST не задан, синхронизация отключена");
  }
});

client.login(TOKEN);
