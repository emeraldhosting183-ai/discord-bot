const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const OWNER_ID = process.env.OWNER_ID || "";

if (!TOKEN) throw new Error("DISCORD_TOKEN не задан");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let botClosed = false;
const CLOSED_MESSAGE = "🔒 Бот временно закрыт\n\nМы готовим что-то новое — бот будет недоступен до релиза.";

function isOwner(userId) { return OWNER_ID && userId === OWNER_ID; }

const commands = [
  new SlashCommandBuilder().setName("помощь").setDescription("Список команд"),
  new SlashCommandBuilder().setName("пинг").setDescription("Проверить работу бота"),
  new SlashCommandBuilder().setName("сервер").setDescription("Инфо о сервере"),
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

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Бот запущен как ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const cmd = interaction.commandName;

  if (botClosed && !(cmd === "закрыть" && isOwner(userId))) {
    return interaction.reply({ content: CLOSED_MESSAGE, ephemeral: true });
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
      .setFooter({ text: "Emerald Bot" });
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
    if (!isOwner(userId)) return interaction.reply({ content: "⛔ Нет доступа.", ephemeral: true });
    botClosed = !botClosed;
    await interaction.reply({
      content: botClosed ? "🔒 Бот закрыт." : "🔓 Бот открыт.",
      ephemeral: true,
    });
  }
});

client.login(TOKEN);
