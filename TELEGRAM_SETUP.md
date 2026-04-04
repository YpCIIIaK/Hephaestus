# 🤖 Telegram Bot — Инструкция по настройке

## Быстрый старт (5 минут)

### Шаг 1: Создание бота в Telegram

1. Открой Telegram и найди **@BotFather** (https://t.me/BotFather)
2. Отправь команду `/newbot`
3. BotFather попросит ввести:
   - **Имя бота** (отображаемое имя, например: "My AI Assistant")
   - **Username бота** (должен заканчиваться на `bot`, например: `my_ai_assistant_bot`)
4. После создания BotFather выдаст **токен** вида:
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
5. **Скопируй этот токен!**

### Шаг 2: Настройка проекта

1. Открой файл `.env` в корне проекта:
   ```env
   TELEGRAM_BOT_TOKEN=ВСТАВЬ_СВОЙ_ТОКЕН_СЮДА
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

2. Замени `ВСТАВЬ_СВОЙ_ТОКЕН_СЮДА` на токен от BotFather:
   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

### Шаг 3: Запуск проекта

```bash
pnpm dev
```

Сервер запустится на `http://localhost:3000`

### Шаг 4: Настройка Webhook

#### Вариант A: Локальная разработка (ngrok)

Для локальной разработки нужен туннель к интернету:

1. Установи [ngrok](https://ngrok.com/download)
2. Запусти туннель:
   ```bash
   ngrok http 3000
   ```
3. Ngrok выдаст URL вида: `https://abc123.ngrok-free.app`
4. Установи webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<ТВОЙ_ТОКЕН>/setWebhook?url=https://abc123.ngrok-free.app/api/telegram/webhook"
   ```
5. Проверь установку:
   ```bash
   curl "https://api.telegram.org/bot<ТВОЙ_ТОКЕН>/getWebhookInfo"
   ```

#### Вариант B: Production (Vercel/свой сервер)

1. Задеплой проект на Vercel/сервер
2. Узнай свой URL (например: `https://my-app.vercel.app`)
3. Установи webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<ТВОЙ_ТОКЕН>/setWebhook?url=https://my-app.vercel.app/api/telegram/webhook"
   ```

### Шаг 5: Тестирование

1. Открой Telegram
2. Найди своего бота по username (который ты создал в шаге 1)
3. Отправь `/start`
4. Бот ответит приветственным сообщением!

---

## 📱 Как пользоваться ботом

### Отправка сообщений

| Что отправить | Что произойдёт |
|---------------|----------------|
| 💬 **Текст** | AI ответит на сообщение |
| 🖼️ **Фото** | AI опишет и проанализирует изображение |
| 📄 **Файл** | AI извлечёт и проанализирует содержимое |
| 🎤 **Голосовое** | Принимается (транскрипция скоро) |

### Команды бота

| Команда | Описание |
|---------|----------|
| `/start` | Приветствие и введение |
| `/help` | Показать все команды |
| `/status` | Информация о твоей сессии |
| `/clear` | Очистить историю чата |
| `/pipeline` | Переключить режим пайплайна |

### Примеры использования

```
User: Привет!
Bot: 👋 Привет! Я твой AI ассистент...

User: Что ты умеешь?
Bot: Я могу отвечать на вопросы, анализировать фото...

User: [отправляешь фото]
Bot: 🖼️ На этом изображении я вижу...

User: /status
Bot: 📊 Session Status
     User ID: 123456789
     Mode: 💬 Chat
     Messages: 5
```

---

## 📊 Мониторинг через веб-интерфейс

1. Открой `http://localhost:3000`
2. В сайдбаре нажми **"Telegram"**
3. Ты увидишь:
   - **Статистика**: пользователи, сообщения, токены, стоимость
   - **Users**: список всех пользователей бота
   - **Messages**: разбивка по типам + график активности
   - **Broadcast**: рассылка сообщений (скоро)

---

## 🔧 Решение проблем

### Бот не отвечает

1. Проверь, что токен правильный в `.env`
2. Проверь, что webhook установлен:
   ```bash
   curl "https://api.telegram.org/bot<ТОКЕН>/getWebhookInfo"
   ```
3. Проверь, что сервер запущен: `http://localhost:3000/api/telegram/webhook`

### Ошибка "TELEGRAM_BOT_TOKEN not set"

Убедись, что в `.env` есть строка:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
```

### Webhook не работает

1. Убедись, что URL доступен из интернета
2. Для локальной разработки используй ngrok
3. Проверь логи сервера на ошибки

### Сброс webhook

```bash
# Удалить текущий webhook
curl -X POST "https://api.telegram.org/bot<ТОКЕН>/deleteWebhook"

# Установить заново
curl -X POST "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=<ТВОЙ_URL>/api/telegram/webhook"
```

---

## 🚀 Production деплой (Vercel)

1. Задеплой проект:
   ```bash
   vercel --prod
   ```

2. Добавь переменные окружения в Vercel:
   - `TELEGRAM_BOT_TOKEN` = твой токен
   - `NEXT_PUBLIC_APP_URL` = URL деплоя

3. Установи webhook:
   ```bash
   curl -X POST "https://api.telegram.org/bot<ТОКЕН>/setWebhook?url=https://ТВОЙ_VERCEL_URL/api/telegram/webhook"
   ```

---

## 📋 Чек-лист настройки

- [ ] Создан бот через @BotFather
- [ ] Токен добавлен в `.env`
- [ ] Сервер запущен (`pnpm dev`)
- [ ] Webhook установлен
- [ ] Бот отвечает на `/start`
- [ ] Веб-панель Telegram открывается