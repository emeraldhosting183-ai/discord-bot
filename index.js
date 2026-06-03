const {
  Client, GatewayIntentBits, Events, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
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
  ],
});

let botClosed = false;
const CLOSED_MESSAGE = "🔒 Бот временно закрыт\n\nМы готовим что-то новое — бот будет недоступен до релиза.";
function isOwner(userId) { return OWNER_ID && userId === OWNER_ID; }

// ── ВЕРИФИКАЦИЯ ────────────────────────────────────────────────────────────
const VERIFY_CHANNEL_ID = "1511752308659327198";

async function initVerification(client) {
  const channel = await client.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    return console.error(`[Verify] Канал ${VERIFY_CHANNEL_ID} не найден.`);
  }

  // Не отправлять повторно при рестарте
  const messages = await channel.messages.fetch({ limit: 20 });
  const alreadyPosted = messages.some(
    msg => msg.author.id === client.user.id &&
           msg.components?.[0]?.components?.some(c => c.customId === "verify_start")
  );
  if (alreadyPosted) {
    return console.log("[Verify] Панель верификации уже есть — пропускаем.");
  }

  const embed = new EmbedBuilder()
    .setColor(0x57F287)
    .setTitle("✅ Верификация через Minecraft")
    .setDescription(
      "Чтобы подтвердить свой аккаунт:\n\n" +
      "1. Зайди на наш Minecraft сервер\n" +
      "2. Введи команду `/link` — получишь код\n" +
      "3. Нажми кнопку ниже и введи этот код\n\n" +
      "Бот проверит код и подтвердит тебя!"
    )
    .setFooter({ text: "Код видит только ты — ответ приходит приватно" });

  const btn = new ButtonBuilder()
    .setCustomId("verify_start")
    .setLabel("🔗 Ввести код верификации")
    .setStyle(ButtonStyle.Success);

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
  console.log("[Verify] Панель верификации отправлена.");
}
// ──────────────────────────────────────────────────────────────────────────

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
  await initVerification(client);
});

client.on(Events.InteractionCreate, async (interaction) => {

  // ── Slash команды ──────────────────────────────────────────────────────────
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

  // ── Анкета (questionnaire.js) ──────────────────────────────────────────────
  await handleQuestionnaire(interaction);

  // ── Верификация — кнопка «Ввести код» ─────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "verify_start") {
    const modal = new ModalBuilder()
      .setCustomId("verify_modal")
      .setTitle("Верификация Minecraft");

    const codeInput = new TextInputBuilder()
      .setCustomId("verify_code")
      .setLabel("Код из Minecraft (/link)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("Введи код который получил в игре")
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(20);

    modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
    return interaction.showModal(modal);
  }

  // ── Верификация — обработка кода ──────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "verify_modal") {
    const code = interaction.fields.getTextInputValue("verify_code").trim();

    // Эта часть отвечает только тебе (ephemeral)
    // DiscordSRV сам проверяет код когда игрок вводит его в чат Minecraft.
    // Здесь мы показываем инструкцию — что именно ввести в игре.
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle("🔗 Почти готово!")
          .setDescription(
            `Твой код: **\`${code}\`**\n\n` +
            "Зайди на Minecraft сервер и введи в чат:\n" +
            `\`\`\`/discord verify ${code}\`\`\`` +
            "\nПосле этого DiscordSRV автоматически подтвердит тебя!"
          )
          .setFooter({ text: "Это сообщение видишь только ты" })
      ],
      flags: 64 // ephemeral
    });
    return;
  }

  // ── Создание тикета ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_create") {
    const guild = interaction.guild;
    const user = interaction.user;

    const existing = guild.channels.cache.find(
      ch => ch.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}` ||
            ch.topic === `ticket:${user.id}`
    );
    if (existing) {
      return interaction.reply({
        content: `У вас уже есть открытый тикет: ${existing}`,
        flags: 64
      });
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
      .setDescription(
        `Добро пожаловать, ${user}!\n\n` +
        "Пожалуйста, опишите вашу проблему здесь.\n" +
        "Администрация скоро ответит вам."
      )
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

  // ── Закрытие тикета ───────────────────────────────────────────────────────
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
