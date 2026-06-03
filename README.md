# Discord Bot — Настройка

## Переменные окружения (.env или панель хостинга)

```
DISCORD_TOKEN=твой_токен_бота
DISCORD_CLIENT_ID=id_приложения
OWNER_ID=твой_discord_id

# Порт для вебхуков от Minecraft сервера
WEBHOOK_PORT=3000

# Секрет для проверки запросов (придумай любой)
WEBHOOK_SECRET=любой_секрет

# URL HTTP API твоего Minecraft сервера (для кика)
MC_API_URL=http://localhost:4567
MC_API_SECRET=секрет_майн_апи
```

---

## Как работает верификация (ЛС)

1. Участник пишет боту в ЛС что угодно
2. Бот объясняет: зайди в игру → `/link` → получи код → пришли сюда
3. Участник присылает код — бот отвечает: введи `/discord verify КОД` в игре
4. DiscordSRV сам подтверждает привязку

---

## Как работает подтверждение входа

При каждом входе игрока на Minecraft сервер нужно слать **POST запрос** на бота:

```
POST http://хост_бота:3000/login
Content-Type: application/json

{
  "secret": "твой_WEBHOOK_SECRET",
  "discordId": "123456789012345678",
  "mcNick": "НикИгрока"
}
```

Бот пишет в ЛС игроку кнопки **Да, это я** / **Нет, не я**.  
Если нажал "Нет" или не ответил за 60 секунд — бот шлёт кик на MC_API_URL.

### Как получить discordId при входе

Используй DiscordSRV + Paper плагин, который при событии `PlayerJoinEvent`:
1. Берёт UUID игрока
2. Ищет привязанный Discord ID через DiscordSRV API: `DiscordSRV.getPlugin().getAccountLinkManager().getDiscordId(uuid)`
3. Шлёт POST на `http://localhost:3000/login`

### Кик — MC_API_URL

Нужен HTTP-эндпоинт на сервере Minecraft который принимает:
```
POST /kick
{ "secret": "...", "nick": "НикИгрока", "reason": "..." }
```
Можно реализовать через плагин **WebAPI** или написать простой Paper плагин.
