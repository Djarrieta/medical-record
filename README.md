# medical-records-2

Telegram bot that saves files to disk. Built with Bun, grammY, and LangChain (DeepSeek).

## Setup

```bash
cp .env.example .env
# fill in BOT_TOKEN and ALLOWED_USER_ID
bun install
bun start
```

## Commands

| Command | Action |
|---|---|
| `/start` | Welcome message |
| Send file / photo | Saves it to disk, replies with ID |
| `/list` | Lists all saved files |
| `/get <id>` | Downloads a file |
| `/delete <id>` | Deletes a file |
| `/note <text>` | Saves a text note |

## Project

```
src/
├── main.ts       # Entry point
├── config.ts     # Typed config from env vars
├── bot.ts        # BotApp — grammY handlers
├── fileStore.ts  # FileStore — disk + bun:sqlite metadata
├── llm.ts        # LlmProvider — LangChain + DeepSeek (singleton)
└── types.ts      # Shared types
```
