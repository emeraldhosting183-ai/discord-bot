const {
  Client, GatewayIntentBits, Events, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID || "";
const ANKETA_CHANNEL_ID = "1504215282854527016";

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
const anketaData = new Map();
const CLOSED_MESSAGE = "🔒 Бот временно закрыт\n\nМы готовим что-то новое — бот будет недоступен до релиза.";
function isOwner(userId) { return OWNER_ID && userId === OWNER_ID; }

const commands = [
  new SlashCommandBuilder().setName("пинг").setDescription("Проверить работу бота"),
  new SlashCommandBuilder().setName("помощь").setDescription("Список команд"),
  new SlashCommandBuilder().setName("сервер").setDescription("Инфо о сервере"),
  new SlashCommandBuilder().setName("закрыть").setDescription("🔒 Закрыть/открыть бота (только владелец)"),
  new SlashCommandBuilder().setName("анкета-канал").setDescription("📋 Отправить кнопку анкеты в этот канал (только владелец)"),
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

    } else if (cmd === "анкета-канал") {
      if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", flags: 64 });

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle("📋 Анкета нового сезона")
        .setDescription(
          "Привет! Для участия в проекте необходимо заполнить анкету.\n\n" +
          "Нажми кнопку ниже и заполни все поля.\n" +
          "После отправки твоя анкета появится у администрации.\n\n" +
          "⚠️ **Анкета обязательна для доступа к серверу!**"
        )
        .setFooter({ text: "Заполни анкету честно и внимательно" });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_anketa")
          .setLabel("📝 Заполнить анкету")
          .setStyle(ButtonStyle.Success)
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: "✅ Кнопка анкеты отправлена!", flags: 64 });
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

  // ── Кнопка анкеты ──────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "open_anketa") {
    const modal = new ModalBuilder()
      .setCustomId("anketa_modal")
      .setTitle("📋 Анкета — Часть 1");

    const fields = [
      new TextInputBuilder().setCustomId("name").setLabel("Имя (реальное)").setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId("birthday").setLabel("Дата рождения (ДД.ММ.ГГГГ) и возраст").setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder("Пример: 08.02.2008 | 17 лет"),
      new TextInputBuilder().setCustomId("mc_nick").setLabel("Ник в Minecraft").setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId("tg_nick").setLabel("Ник в Telegram").setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId("time_in_group").setLabel("Сколько ты в группе? (из TG «Кто я»)").setStyle(TextInputStyle.Short).setRequired(true),
    ];

    const rows = fields.map(f => new ActionRowBuilder().addComponents(f));
    modal.addComponents(...rows);
    await interaction.showModal(modal);
  }

  // ── Модальное окно часть 1 ─────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "anketa_modal") {
    const name = interaction.fields.getTextInputValue("name");
    const birthday = interaction.fields.getTextInputValue("birthday");
    const mcNick = interaction.fields.getTextInputValue("mc_nick");
    const tgNick = interaction.fields.getTextInputValue("tg_nick");
    const timeInGroup = interaction.fields.getTextInputValue("time_in_group");

    // Сохраняем данные в памяти и показываем вторую часть
    const dataKey = `${interaction.user.id}_${Date.now()}`;
    anketaData.set(dataKey, { name, birthday, mcNick, tgNick, timeInGroup });

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`anketa_p2_${dataKey}`)
        .setLabel("➡️ Продолжить — Часть 2")
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.reply({
      content: "✅ Часть 1 принята! Нажми кнопку чтобы заполнить вторую часть.",
      components: [row2],
      flags: 64
    });
  }

  // ── Кнопка части 2 ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("anketa_p2_")) {
    const dataKey = interaction.customId.slice("anketa_p2_".length);
    const modal2 = new ModalBuilder()
      .setCustomId("anketa_modal2_" + dataKey)
      .setTitle("📋 Анкета — Часть 2");

    const fields2 = [
      new TextInputBuilder().setCustomId("pc").setLabel("Комплектующие ПК/ноута + FPS на Optifine 1.21+").setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder("Процессор, видеокарта, ОЗУ, Windows, ~FPS"),
      new TextInputBuilder().setCustomId("who_invited").setLabel("Через кого попал в чат? (ник)").setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId("study").setLabel("Учишься? (Да/Нет — если да, класс/курс)").setStyle(TextInputStyle.Short).setRequired(true),
      new TextInputBuilder().setCustomId("playtime").setLabel("Время игры + Java/Bedrock + интернет + микрофон").setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder("С скольки до скольки | Java/Bedrock | Интернет | Микрофон"),
      new TextInputBuilder().setCustomId("goal").setLabel("Цель + страна + часовой пояс + сколько лет в MC").setStyle(TextInputStyle.Paragraph).setRequired(true),
    ];

    const rows2 = fields2.map(f => new ActionRowBuilder().addComponents(f));
    modal2.addComponents(...rows2);
    await interaction.showModal(modal2);
  }

  // ── Создание тикета ───────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId === "ticket_create") {
    const guild = interaction.guild;
    const user = interaction.user;

    // Проверяем, нет ли уже открытого тикета у этого юзера
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

    // Ищем категорию "Поддержка" (или берём без категории)
    const category = guild.channels.cache.find(
      ch => ch.type === 4 && ch.name.toLowerCase().includes("поддержк")
    );

    // Ищем роль администрации
    const adminRole = guild.roles.cache.find(
      r => r.name === "ГЛ.АДМИНИСТРАЦИЯ" || r.name === "Senior Moderators" || r.permissions.has("Administrator")
    );

    const permissionOverwrites = [
      { id: guild.id, deny: ["ViewChannel"] }, // @everyone не видит
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
        type: 0, // GUILD_TEXT
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

    // Проверяем что это тикет-канал
    if (!channel.topic?.startsWith("ticket:") && !channel.name.startsWith("ticket-")) {
      return interaction.reply({ content: "❌ Это не тикет-канал.", flags: 64 });
    }

    await interaction.reply({ content: "🔒 Тикет закрывается, канал будет удалён через 5 секунд..." });
    setTimeout(() => channel.delete("Тикет закрыт").catch(console.error), 5000);
  }

  // ── Модальное окно часть 2 ────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith("anketa_modal2_")) {
    const dataKey = interaction.customId.slice("anketa_modal2_".length);
    const stored = anketaData.get(dataKey) || {};
    anketaData.delete(dataKey);
    const { name = "?", birthday = "?", mcNick = "?", tgNick = "?", timeInGroup = "?" } = stored;

    const pc = interaction.fields.getTextInputValue("pc");
    const whoInvited = interaction.fields.getTextInputValue("who_invited");
    const study = interaction.fields.getTextInputValue("study");
    const playtime = interaction.fields.getTextInputValue("playtime");
    const goal = interaction.fields.getTextInputValue("goal");

    const member = interaction.guild?.members?.cache.get(interaction.user.id);
    const roles = member?.roles?.cache
      .filter(r => r.id !== interaction.guild.id)
      .map(r => r.name)
      .join(", ") || "Нет ролей";

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("📋 Новая анкета")
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: "👤 Discord", value: `${interaction.user} (${interaction.user.tag})`, inline: true },
        { name: "🎭 Роли", value: roles, inline: true },
        { name: "\u200b", value: "\u200b" },
        { name: "📛 Имя", value: name, inline: true },
        { name: "🎂 Дата рождения / Возраст", value: birthday, inline: true },
        { name: "⛏️ Ник в Minecraft", value: mcNick, inline: true },
        { name: "📱 Ник в Telegram", value: tgNick, inline: true },
        { name: "⏱️ В группе с", value: timeInGroup, inline: true },
        { name: "💻 ПК / FPS", value: pc },
        { name: "👥 Пригласил", value: whoInvited, inline: true },
        { name: "🎓 Учёба", value: study, inline: true },
        { name: "🕐 Время игры / Java-Bedrock / Интернет / Микрофон", value: playtime },
        { name: "🎯 Цель / Страна / Часовой пояс / Стаж в MC", value: goal },
      )
      .setTimestamp()
      .setFooter({ text: `ID: ${interaction.user.id}` });

    const anketaChannel = await client.channels.fetch(ANKETA_CHANNEL_ID).catch(() => null);
    if (anketaChannel) {
      await anketaChannel.send({ embeds: [embed] });
    }

    await interaction.reply({
      content: "✅ Анкета отправлена! Ожидай проверки от администрации.",
      flags: 64
    });
  }
});

client.login(TOKEN);
