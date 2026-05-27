const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require("discord.js");
const Anthropic = require("@anthropic-ai/sdk");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OWNER_ID = process.env.OWNER_ID || "";

if (!TOKEN) throw new Error("DISCORD_TOKEN не задан");
if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY не задан");

const ai = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

let botClosed = false;
const conversationHistory = new Map();
const HISTORY_LIMIT = 10;

const commands = [
  new SlashCommandBuilder().setName("ai").setDescription("Спросить ИИ").addStringOption((opt) => opt.setName("вопрос").setDescription("Твой вопрос").setRequired(true)),
  new SlashCommandBuilder().setName("сброс").setDescription("Сбросить историю диалога с ИИ"),
  new SlashCommandBuilder().setName("помощь").setDescription("Список команд"),
  new SlashCommandBuilder().setName("закрыть").setDescription("🔒 Закрыть/открыть бота (только владелец)"),
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  if (!CLIENT_ID) return;
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Slash команды зарегистрированы");
  } catch (e) { console.error(e); }
}

async function askAI(userId, userMessage, username) {
  const history = conversationHistory.get(userId) || [];
  history.push({ role: "user", content: userMessage });
  if (history.length > HISTORY_LIMIT * 2) history.splice(0, 2);
  const response = await ai.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `Ты дружелюбный помощник в Discord сервере. Отвечай живо и по-русски. Без markdown разметки. Сейчас тебе пишет: ${username}`,
    messages: history,
  });
  const reply = response.content[0].text;
  history.push({ role: "assistant", content: reply });
  conversationHistory.set(userId, history);
  return reply;
}

function isOwner(userId) { return OWNER_ID && userId === OWNER_ID; }
const CLOSED_MESSAGE = "🔒 Бот временно закрыт\n\nМы готовим что-то новое — бот будет недоступен до релиза.";

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Бот запущен как ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const cmd = interaction.commandName;
  if (botClosed && !(cmd === "закрыть" && isOwner(userId))) return interaction.reply({ content: CLOSED_MESSAGE, ephemeral: true });
  if (cmd === "ai") {
    await interaction.deferReply();
    try {
      const answer = await askAI(userId, interaction.options.getString("вопрос"), interaction.user.username);
      await interaction.editReply(answer.slice(0, 2000));
    } catch (e) { await interaction.editReply("❌ Ошибка. Попробуй позже."); }
  } else if (cmd === "сброс") {
    conversationHistory.delete(userId);
    await interaction.reply({ content: "🔄 История сброшена.", ephemeral: true });
  } else if (cmd === "помощь") {
    await interaction.reply({ content: "📋 Команды:\n/ai [вопрос] — спросить ИИ\n/сброс — сбросить историю\n/помощь — этот список\n\nИли просто упомяни меня!", ephemeral: true });
  } else if (cmd === "закрыть") {
    if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", ephemeral: true });
    botClosed = !botClosed;
    await interaction.reply({ content: botClosed ? "🔒 Бот закрыт." : "🔓 Бот открыт.", ephemeral: true });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user)) return;
  const userId = message.author.id;
  if (botClosed && !isOwner(userId)) return message.reply(CLOSED_MESSAGE);
  const text = message.content.replace(/<@!?\d+>/g, "").trim();
  if (!text) return message.reply("Привет! Напиши вопрос после упоминания 😊");
  try {
    message.channel.sendTyping();
    const answer = await askAI(userId, text, message.author.username);
    await message.reply(answer.slice(0, 2000));
  } catch (e) { await message.reply("❌ Ошибка. Попробуй позже."); }
});

client.login(TOKEN);
