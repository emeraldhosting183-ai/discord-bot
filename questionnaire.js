// ============================================================
//  questionnaire.js  —  Многошаговая анкета (8 шагов × 5 вопросов)
//  discord.js v14  |  Хранение ответов: answers.json
// ============================================================

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────
//  НАСТРОЙКИ
// ─────────────────────────────────────────────
const APPLY_CHANNEL_ID  = '1504215282854527016';
const ADMIN_CHANNEL_ID  = '1511000055119876208';
const ANSWERS_FILE      = path.join(__dirname, 'answers.json');

// customId-ы кнопок и модалок (фиксированные — persistent)
const BTN_START   = 'anket_start';           // кнопка «Заполнить анкету»
const BTN_NEXT    = 'anket_next_';           // + номер шага (anket_next_1 … anket_next_7)
const MODAL_STEP  = 'anket_modal_step_';     // + номер шага (1…8)

// ─────────────────────────────────────────────
//  ВОПРОСЫ — 40 штук, 8 групп по 5
//  Меняйте label / placeholder здесь
// ─────────────────────────────────────────────
const STEPS = [
  // ШАГ 1 — Личное
  {
    title: '📋 Анкета участника — Шаг 1 из 8',
    fields: [
      { id: 'q01', label: 'Твоё имя',             style: TextInputStyle.Short,     placeholder: 'Как тебя зовут?' },
      { id: 'q02', label: 'Дата рождения / День рождения', style: TextInputStyle.Short, placeholder: 'ДД.ММ.ГГГГ | ДД.ММ' },
      { id: 'q03', label: 'Возраст',               style: TextInputStyle.Short,     placeholder: 'Полных лет' },
      { id: 'q04', label: 'Пол',                   style: TextInputStyle.Short,     placeholder: 'Мужской / Женский / Другое' },
      { id: 'q05', label: 'Страна',                style: TextInputStyle.Short,     placeholder: 'Твоя страна' },
    ],
  },
  // ШАГ 2 — Контакты и учёба
  {
    title: '📋 Анкета участника — Шаг 2 из 8',
    fields: [
      { id: 'q06', label: 'Часовой пояс',          style: TextInputStyle.Short,     placeholder: 'Например: UTC+3' },
      { id: 'q07', label: 'Учёба',                 style: TextInputStyle.Short,     placeholder: 'Да/Нет | Если да — класс или курс' },
      { id: 'q08', label: 'Ник в Minecraft',       style: TextInputStyle.Short,     placeholder: 'Твой ник' },
      { id: 'q09', label: 'Ник в Telegram',        style: TextInputStyle.Short,     placeholder: '@ник' },
      { id: 'q10', label: 'Кто позвал?',           style: TextInputStyle.Short,     placeholder: 'Ник пригласившего' },
    ],
  },
  // ШАГ 3 — Группа и железо
  {
    title: '📋 Анкета участника — Шаг 3 из 8',
    fields: [
      { id: 'q11', label: 'Сколько в группе?',     style: TextInputStyle.Short,     placeholder: 'Напиши /кто я в тг группе' },
      { id: 'q12', label: 'Твои комплектующие',    style: TextInputStyle.Paragraph, placeholder: 'Процессор, видеокарта, ОЗУ' },
      { id: 'q13', label: 'Версия Windows',        style: TextInputStyle.Short,     placeholder: 'Например: Windows 11' },
      { id: 'q14', label: 'FPS',                   style: TextInputStyle.Short,     placeholder: 'Optifine 1.21+, средние настройки' },
      { id: 'q15', label: 'Java или Bedrock',      style: TextInputStyle.Short,     placeholder: 'Java / Bedrock' },
    ],
  },
  // ШАГ 4 — Оборудование и интернет
  {
    title: '📋 Анкета участника — Шаг 4 из 8',
    fields: [
      { id: 'q16', label: 'Микрофон',              style: TextInputStyle.Short,     placeholder: 'Есть / Нет' },
      { id: 'q17', label: 'Камера',                style: TextInputStyle.Short,     placeholder: 'Есть / Нет' },
      { id: 'q18', label: 'Программа для записи',  style: TextInputStyle.Short,     placeholder: 'OBS, Bandicam, другое…' },
      { id: 'q19', label: 'Интернет',              style: TextInputStyle.Short,     placeholder: 'Плохой / Средний / Хороший' },
      { id: 'q20', label: 'ПК или ноутбук',        style: TextInputStyle.Short,     placeholder: 'ПК / Ноутбук' },
    ],
  },
  // ШАГ 5 — Minecraft
  {
    title: '📋 Анкета участника — Шаг 5 из 8',
    fields: [
      { id: 'q21', label: 'Лет в Minecraft',       style: TextInputStyle.Short,     placeholder: 'Сколько лет играешь?' },
      { id: 'q22', label: 'Любимый режим',         style: TextInputStyle.Short,     placeholder: 'Выживание, мини-игры, творческий…' },
      { id: 'q23', label: 'Любимая версия',        style: TextInputStyle.Short,     placeholder: 'Например: 1.21' },
      { id: 'q24', label: 'PVE / PVP / Строительство', style: TextInputStyle.Short, placeholder: 'слабый / средний / сильный (по каждому)' },
      { id: 'q25', label: 'Любимый жанр видео по Майнкрафту', style: TextInputStyle.Short, placeholder: 'Выживание, летсплей, туториал…' },
    ],
  },
  // ШАГ 6 — Другие игры и аккаунты
  {
    title: '📋 Анкета участника — Шаг 6 из 8',
    fields: [
      { id: 'q26', label: 'Какие ещё игры играешь', style: TextInputStyle.Short,    placeholder: 'Перечисли' },
      { id: 'q27', label: 'Аккаунт Xbox',           style: TextInputStyle.Short,    placeholder: 'Ник или ссылка' },
      { id: 'q28', label: 'Аккаунт Steam',          style: TextInputStyle.Short,    placeholder: 'Ник или ссылка' },
      { id: 'q29', label: 'Есть YouTube / TikTok канал?', style: TextInputStyle.Short, placeholder: 'Да / Нет | Если да — ссылка' },
      { id: 'q30', label: 'Был ли опыт в других командах?', style: TextInputStyle.Short, placeholder: 'Да / Нет | Если да — коротко' },
    ],
  },
  // ШАГ 7 — Мотивация
  {
    title: '📋 Анкета участника — Шаг 7 из 8',
    fields: [
      { id: 'q31', label: 'С какой целью пришёл',  style: TextInputStyle.Paragraph, placeholder: 'Расскажи зачем ты здесь' },
      { id: 'q32', label: 'Что ожидаешь от команды', style: TextInputStyle.Paragraph, placeholder: 'Твои ожидания' },
      { id: 'q33', label: 'Одна причина почему тебя стоит взять', style: TextInputStyle.Paragraph, placeholder: 'Убеди нас' },
      { id: 'q34', label: 'Что умеешь делать в команде помимо игры', style: TextInputStyle.Paragraph, placeholder: 'Монтаж, дизайн, менеджмент…' },
      { id: 'q35', label: 'Готов ли к критике и замечаниям', style: TextInputStyle.Short, placeholder: 'Да / Нет' },
    ],
  },
  // ШАГ 8 — Финал
  {
    title: '📋 Анкета участника — Шаг 8 из 8',
    fields: [
      { id: 'q36', label: 'Готов ли играть по расписанию', style: TextInputStyle.Short, placeholder: 'Да / Нет / Иногда' },
      { id: 'q37', label: 'Уведомления в Telegram включены', style: TextInputStyle.Short, placeholder: 'Да / Нет' },
      { id: 'q38', label: 'Правила прочитал',       style: TextInputStyle.Short,     placeholder: 'Да / Ещё нет, прочитаю' },
      { id: 'q39', label: 'Свободное поле — доп. инфо', style: TextInputStyle.Paragraph, placeholder: 'Любое дополнение, если хочешь' },
      { id: 'q40', label: 'Подтверждение',          style: TextInputStyle.Short,     placeholder: 'Напиши: Анкета заполнена верно' },
    ],
  },
];

// ─────────────────────────────────────────────
//  УТИЛИТЫ — работа с answers.json
// ─────────────────────────────────────────────

/** Загружает весь файл ответов (или возвращает {}) */
function loadAnswers() {
  if (!fs.existsSync(ANSWERS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(ANSWERS_FILE, 'utf8')); }
  catch { return {}; }
}

/** Сохраняет весь файл ответов */
function saveAnswers(data) {
  fs.writeFileSync(ANSWERS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/** Получает сессию пользователя */
function getSession(userId) {
  const all = loadAnswers();
  return all[userId] ?? null;
}

/** Устанавливает / обновляет сессию пользователя */
function setSession(userId, session) {
  const all = loadAnswers();
  all[userId] = session;
  saveAnswers(all);
}

/** Удаляет сессию пользователя (после отправки или отмены) */
function deleteSession(userId) {
  const all = loadAnswers();
  delete all[userId];
  saveAnswers(all);
}

// ─────────────────────────────────────────────
//  ПОСТРОЕНИЕ MODAL ДЛЯ ШАГА
// ─────────────────────────────────────────────

function buildModal(stepIndex) {
  const step  = STEPS[stepIndex];
  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_STEP}${stepIndex + 1}`)
    .setTitle(step.title);

  const rows = step.fields.map((f) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(f.id)
        .setLabel(f.label)
        .setStyle(f.style)
        .setPlaceholder(f.placeholder)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(f.style === TextInputStyle.Paragraph ? 500 : 150),
    ),
  );

  modal.addComponents(...rows);
  return modal;
}

// ─────────────────────────────────────────────
//  ПОСТРОЕНИЕ ФИНАЛЬНОГО EMBED ДЛЯ АДМИНИСТРАЦИИ
// ─────────────────────────────────────────────

function buildAdminEmbed(user, answers) {
  // Все 40 вопросов плоско
  const allFields = STEPS.flatMap((s) => s.fields);

  // Discord позволяет до 25 полей в одном Embed — делаем 2 эмбеда
  const embed1 = new EmbedBuilder()
    .setTitle(`📋 Анкета пользователя ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp();

  const embed2 = new EmbedBuilder();

  allFields.forEach((f, i) => {
    const value = answers[f.id] || '—';
    const field = { name: f.label, value, inline: true };
    if (i < 25) embed1.addFields(field);
    else        embed2.addFields(field);
  });

  return [embed1, embed2];
}

// ─────────────────────────────────────────────
//  1. ИНИЦИАЛИЗАЦИЯ — запускается при старте бота
// ─────────────────────────────────────────────

async function initQuestionnaire(client) {
  const channel = await client.channels.fetch(APPLY_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    return console.error(`[Questionnaire] Канал ${APPLY_CHANNEL_ID} не найден.`);
  }

  // Проверяем: есть ли уже наша кнопка (защита от повторной отправки при рестарте)
  const messages = await channel.messages.fetch({ limit: 30 });
  const alreadyPosted = messages.some(
    (msg) =>
      msg.author.id === client.user.id &&
      msg.components?.[0]?.components?.some((c) => c.customId === BTN_START),
  );

  if (alreadyPosted) {
    return console.log('[Questionnaire] Сообщение с кнопкой уже есть — пропускаем.');
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 Подача заявки в команду')
    .setDescription(
      '**Приветствуем!**\n\n' +
      'Чтобы подать заявку — заполни анкету из **40 вопросов**.\n' +
      'Это займёт ~5 минут. Анкета разбита на **8 коротких шагов**.\n\n' +
      '⚠️ Заполнять строго по образцу. Неправильно заполненная анкета **удаляется**.\n' +
      'Без анкеты — доступа нет никуда.',
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Нажми кнопку ниже чтобы начать' })
    .setTimestamp();

  const btn = new ButtonBuilder()
    .setCustomId(BTN_START)
    .setLabel('📝 Заполнить анкету')
    .setStyle(ButtonStyle.Primary);

  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] });
  console.log('[Questionnaire] Сообщение с кнопкой отправлено.');
}

// ─────────────────────────────────────────────
//  2. ОБРАБОТЧИК ВЗАИМОДЕЙСТВИЙ
// ─────────────────────────────────────────────

async function handleQuestionnaire(interaction) {

  // ── КНОПКА «Заполнить анкету» (шаг 1) ────────────────────
  if (interaction.isButton() && interaction.customId === BTN_START) {
    // Создаём / сбрасываем сессию
    setSession(interaction.user.id, { step: 1, answers: {} });
    return interaction.showModal(buildModal(0));
  }

  // ── КНОПКА «Далее» (шаги 2–8) ────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith(BTN_NEXT)) {
    const nextStep = parseInt(interaction.customId.replace(BTN_NEXT, ''), 10); // 2…8
    const session  = getSession(interaction.user.id);

    if (!session) {
      return interaction.reply({ content: '❌ Сессия не найдена. Начни анкету заново.', ephemeral: true });
    }

    setSession(interaction.user.id, { ...session, step: nextStep });
    return interaction.showModal(buildModal(nextStep - 1));
  }

  // ── ОТПРАВКА МОДАЛКИ ──────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith(MODAL_STEP)) {
    const stepNum = parseInt(interaction.customId.replace(MODAL_STEP, ''), 10); // 1…8
    const session = getSession(interaction.user.id);

    if (!session) {
      return interaction.reply({ content: '❌ Сессия истекла. Пожалуйста, начни заново.', ephemeral: true });
    }

    // Сохраняем ответы текущего шага
    const stepFields = STEPS[stepNum - 1].fields;
    const newAnswers = { ...session.answers };
    for (const f of stepFields) {
      newAnswers[f.id] = interaction.fields.getTextInputValue(f.id);
    }

    // ─ Если это НЕ последний шаг — показываем кнопку «Далее» ─
    if (stepNum < STEPS.length) {
      setSession(interaction.user.id, { step: stepNum + 1, answers: newAnswers });

      const nextBtn = new ButtonBuilder()
        .setCustomId(`${BTN_NEXT}${stepNum + 1}`)
        .setLabel(`➡️ Шаг ${stepNum + 1} из ${STEPS.length}`)
        .setStyle(ButtonStyle.Secondary);

      const progressBar = '█'.repeat(stepNum) + '░'.repeat(STEPS.length - stepNum);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setDescription(
              `✅ **Шаг ${stepNum} сохранён!**\n\n` +
              `Прогресс: \`${progressBar}\` ${stepNum}/${STEPS.length}\n\n` +
              'Нажми кнопку ниже чтобы продолжить.',
            ),
        ],
        components: [new ActionRowBuilder().addComponents(nextBtn)],
        ephemeral: true,
      });
    }

    // ─ Последний шаг — отправляем анкету ─────────────────────
    deleteSession(interaction.user.id);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setDescription(
            '🎉 **Анкета отправлена!**\n\nМы рассмотрим её в ближайшее время и свяжемся с тобой.',
          ),
      ],
      ephemeral: true,
    });

    // Отправляем в канал администрации
    const adminChannel = await interaction.client.channels.fetch(ADMIN_CHANNEL_ID).catch(() => null);
    if (!adminChannel?.isTextBased()) {
      return console.error(`[Questionnaire] Админ-канал ${ADMIN_CHANNEL_ID} недоступен.`);
    }

    const embeds = buildAdminEmbed(interaction.user, newAnswers);
    await adminChannel.send({
      content: `📥 Поступила новая анкета от пользователя ${interaction.user}`,
      embeds,
    });

    console.log(`[Questionnaire] Анкета от ${interaction.user.tag} успешно отправлена.`);
  }
}

// ─────────────────────────────────────────────
//  ЭКСПОРТ
// ─────────────────────────────────────────────
module.exports = { initQuestionnaire, handleQuestionnaire };


// ─────────────────────────────────────────────
//  КАК ПОДКЛЮЧИТЬ В index.js / bot.js
// ─────────────────────────────────────────────
//
//  const { Client, GatewayIntentBits } = require('discord.js');
//  const { initQuestionnaire, handleQuestionnaire } = require('./questionnaire');
//
//  const client = new Client({
//    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
//  });
//
//  client.once('ready', async () => {
//    console.log(`Бот запущен как ${client.user.tag}`);
//    await initQuestionnaire(client);
//  });
//
//  client.on('interactionCreate', async (interaction) => {
//    await handleQuestionnaire(interaction);
//    // ... другие ваши обработчики
//  });
//
//  client.login(process.env.DISCORD_TOKEN);
